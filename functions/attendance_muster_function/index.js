'use strict';

const catalyst = require('zcatalyst-sdk-node');
const http = require('http');
const https = require('https');
const url = require('url');

module.exports = async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const zcql = catalystApp.zcql();

    /** True for CompOff *taken* CO day only — not for CompOffWorkedOn (substring "CompOff" must not match). */
    function sourceHasCompOffTakenSegment(source) {
      const s = String(source || '');
      if (s === 'CompOff') return true;
      return /(^|\+)CompOff($|\+)/.test(s);
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const startDateRaw = url.searchParams.get('startDate');
    const endDateRaw = url.searchParams.get('endDate');
    const userEmail = url.searchParams.get('userEmail');
    const userRole = url.searchParams.get('userRole');
    const contractor = url.searchParams.get('contractor');
    const department = url.searchParams.get('department');
    const status = url.searchParams.get('status');
    const source = (url.searchParams.get('source') || 'both').toLowerCase();
    const normalizedUserEmail = String(userEmail || '').trim().toLowerCase();
    const unrestrictedMusterEmails = new Set([
      'vaisaliofficial@gmail.com',
      'ssindus@gmail.com',
      'kyrarebagame@gmail.com'
    ]);

    console.log('Attendance Muster request:', {
      userEmail,
      userRole,
      startDateRaw,
      endDateRaw,
      contractor,
      department,
      status,
      source
    });
   
    // Check if contractor is manually selected
    const isContractorManuallySelected = contractor && contractor !== 'All';
    console.log(`[${userEmail}] Contractor parameter: "${contractor}", Is manually selected: ${isContractorManuallySelected}`);

    if (!startDateRaw || !endDateRaw) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Start date and end date are required' }));
      return;
    }

    // Normalize to YYYY-MM-DD for ZCQL date comparison
    const toYMD = (s) => {
      if (!s) return s;
      // If already YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      // If DD-MM-YYYY or DD/MM/YYYY
      const m = s.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      // Fallback via Date parse
      const d = new Date(s);
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
      return s; // last resort
    };

    const startDate = toYMD(startDateRaw);
    const endDate = toYMD(endDateRaw);

    // Validate and cap range to 31 days
    const dateStartObj = new Date(startDate);
    const dateEndObj = new Date(endDate);
    const daysDiff = Math.ceil((dateEndObj - dateStartObj) / (1000 * 60 * 60 * 24));
    if (daysDiff > 31) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Date range cannot exceed 31 days to prevent timeout' }));
      return;
    }

    // Build date list
    const dates = [];
    for (let d = new Date(dateStartObj); d <= dateEndObj; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    console.log(`Processing attendance muster for ${dates.length} days: ${startDate} to ${endDate}`);

    // Get employee filter conditions based on user role and filters
    let employeeFilterConditions = [];
    let employeeIds = [];

    // Contractor filtering for App User role and specific App Administrators
    // Also apply filtering for App Administrators with email afrindinusha@gmail.com
    // For App Users: Apply automatic filtering ONLY if no contractor is manually selected
    // For App Administrators with afrindinusha@gmail.com or rpdmanpowerservice@gmail.com: Only apply if no manual selection
    if (
      !unrestrictedMusterEmails.has(normalizedUserEmail) &&
      (userRole === 'App User' || (userRole === 'App Administrator' && (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com"))) &&
      userEmail
    ) {
      let contractorName = null;
     
      // For App Users: Apply automatic filtering ONLY if no contractor is manually selected
      // For App Administrators with afrindinusha@gmail.com: Only apply if no manual selection
      // If contractor is manually selected, skip automatic filtering and use manual selection instead
      if (!isContractorManuallySelected) {
        // Special case for specific emails - hardcode the contractor name
        if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
          // Try to find the actual contractor name in the database (could have variations like extra spaces)
          try {
            const balajiQuery = await zcql.executeZCQLQuery(
              `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Balaji%' OR ContractorName LIKE '%balaji%' LIMIT 5`
            );
            if (balajiQuery && balajiQuery.length > 0) {
              // Use the first matching contractor name found in the database
              contractorName = balajiQuery[0].Employee?.ContractorName;
              console.log(`[dinushaafrin@gmail.com] Found contractor name in database: ${contractorName}`);
            } else {
              // Fallback to standard form
              contractorName = "Sri Balaji Enterprises";
              console.log(`[dinushaafrin@gmail.com] No Balaji contractor found in database, using fallback: ${contractorName}`);
            }
          } catch (balajiError) {
            // Fallback to standard form if query fails
            contractorName = "Sri Balaji Enterprises";
            console.log(`[dinushaafrin@gmail.com] Query failed, using fallback contractor name: ${contractorName}`);
          }
        } else if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
          contractorName = "Sriram Enterprises";
        } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
          contractorName = "R.P.D Facility Management Services";
        } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
          // Try to find the actual contractor name in the database (could be "Samuel Enterprise" or "Samuel Enterprises")
          try {
            const samuelQuery = await zcql.executeZCQLQuery(
              `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Samuel%' LIMIT 5`
            );
            if (samuelQuery && samuelQuery.length > 0) {
              // Use the first matching contractor name found in the database
              contractorName = samuelQuery[0].Employee?.ContractorName;
              console.log(`[afrinatlin@gmail.com] Found contractor name in database: ${contractorName}`);
            } else {
              // Fallback to plural form (most common)
              contractorName = "Samuel Enterprises";
              console.log(`[afrinatlin@gmail.com] No Samuel contractor found in database, using fallback: ${contractorName}`);
            }
          } catch (samuelError) {
            // Fallback to plural form if query fails
            contractorName = "Samuel Enterprises";
            console.log(`[afrinatlin@gmail.com] Query failed, using fallback contractor name: ${contractorName}`);
          }
        } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
          contractorName = "Yashaswi Academy for Skills";
          console.log(`[${userEmail}] Setting contractorName to: ${contractorName}`);
        } else {
          // For other App Users, try to find contractor by email
          try {
            console.log(`[${userEmail}] Attempting to find contractor by PrimaryEmail: ${userEmail}`);
            const contractorQuery = await zcql.executeZCQLQuery(
              `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
            );
           
            if (contractorQuery && contractorQuery.length > 0) {
              contractorName = contractorQuery[0].Contractors.ContractorName;
              console.log(`[${userEmail}] Found contractor from Contractors table: ${contractorName}`);
            } else {
              console.log(`[${userEmail}] No contractor found in Contractors table with PrimaryEmail = '${userEmail}'`);
              // Try alternative field names in case PrimaryEmail is not the correct field
              try {
                const altQuery = await zcql.executeZCQLQuery(
                  `SELECT ROWID, ContractorName, Email, PrimaryEmail, ContactEmail FROM Contractors WHERE Email = '${userEmail}' OR ContactEmail = '${userEmail}' OR PrimaryEmail = '${userEmail}'`
                );
                if (altQuery && altQuery.length > 0) {
                  contractorName = altQuery[0].Contractors.ContractorName;
                  console.log(`[${userEmail}] Found contractor using alternative email fields: ${contractorName}`);
                }
              } catch (altError) {
                console.error(`[${userEmail}] Error trying alternative email fields:`, altError);
              }
            }
          } catch (error) {
            console.error(`[${userEmail}] Error filtering by contractor:`, error);
            // Try alternative query in case of error
            try {
              const altQuery = await zcql.executeZCQLQuery(
                `SELECT ROWID, ContractorName FROM Contractors WHERE Email = '${userEmail}'`
              );
              if (altQuery && altQuery.length > 0) {
                contractorName = altQuery[0].Contractors.ContractorName;
                console.log(`[${userEmail}] Found contractor using Email field: ${contractorName}`);
              }
            } catch (altError) {
              console.error(`[${userEmail}] Error trying Email field:`, altError);
            }
          }
        }
       
        // Log if contractor name is still null after all attempts
        if (!contractorName) {
          console.error(`[${userEmail}] WARNING: Could not determine contractor name for App User. Attempting to find contractor from Employee table...`);
          // As a last resort, try to find contractor by checking if any employees have this email as a contact
          // This is a fallback in case the Contractors table doesn't have the email
          try {
            // Try to find contractor by checking employee records (if they have email field)
            // This is a fallback mechanism
            const empContractorQuery = await zcql.executeZCQLQuery(
              `SELECT DISTINCT ContractorName FROM Employee LIMIT 100`
            );
            const availableContractors = empContractorQuery.map(row => row.Employee?.ContractorName).filter(Boolean);
            console.log(`[${userEmail}] Available contractors in Employee table (sample): ${availableContractors.slice(0, 10).join(', ')}`);
           
            // Also check Contractors table to see what emails are available
            try {
              const allContractorsQuery = await zcql.executeZCQLQuery(
                `SELECT ROWID, ContractorName, PrimaryEmail, Email, ContactEmail FROM Contractors LIMIT 50`
              );
              console.log(`[${userEmail}] Contractors in Contractors table (sample):`,
                allContractorsQuery.slice(0, 5).map(row => ({
                  name: row.Contractors?.ContractorName,
                  primaryEmail: row.Contractors?.PrimaryEmail,
                  email: row.Contractors?.Email,
                  contactEmail: row.Contractors?.ContactEmail
                }))
              );
            } catch (debugErr) {
              console.error(`[${userEmail}] Error fetching contractors for debugging:`, debugErr);
            }
          } catch (fallbackError) {
            console.error(`[${userEmail}] Error in fallback contractor lookup:`, fallbackError);
          }
         
          // For App Users, if we can't find contractor, return empty result with error message
          if (userRole === 'App User') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              dates,
              employees: [],
              muster: [],
              error: `Could not determine contractor for user ${userEmail}. Please ensure the contractor is properly configured in the Contractors table with PrimaryEmail matching the user's email.`
            }));
            return;
          }
        }
       
        // Filter attendance by contractor name through Employee table (using flexible matching)
        if (contractorName) {
          try {
            // Use flexible matching for contractor names
            const normalizedContractor = String(contractorName || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
            console.log(`[${userEmail}] Automatic filtering: Searching for employees with contractor name: "${normalizedContractor}"`);
           
            // Try multiple query strategies to find employees
            let employeeQuery = [];
           
            // Strategy 1: Try exact match first
            try {
              const exactQuery = await zcql.executeZCQLQuery(
                `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${normalizedContractor}'`
              );
              if (exactQuery && exactQuery.length > 0) {
                employeeQuery = exactQuery;
                console.log(`[${userEmail}] Automatic filter - Exact match query found ${exactQuery.length} employees`);
              }
            } catch (exactError) {
              console.log(`[${userEmail}] Automatic filter - Exact match query failed: ${exactError.message}`);
            }
           
            // Strategy 2: If exact match failed, try LIKE query with flexible space matching
            if (employeeQuery.length === 0) {
              try {
                // For Balaji, try multiple LIKE patterns to handle extra spaces
                if (normalizedContractor.toLowerCase().includes('balaji')) {
                  // Try pattern that matches any number of spaces
                  const words = normalizedContractor.split(/\s+/).filter(w => w.length > 0);
                  if (words.length >= 2) {
                    // Build pattern like: %Sri%Balaji%Enterprises%
                    const flexiblePattern = words.join('%');
                    const likeQuery = await zcql.executeZCQLQuery(
                      `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${flexiblePattern}%'`
                    );
                    if (likeQuery && likeQuery.length > 0) {
                      employeeQuery = likeQuery;
                      console.log(`[${userEmail}] Automatic filter - Flexible LIKE query (space-tolerant) found ${likeQuery.length} employees`);
                    }
                  }
                }
               
                // If flexible pattern didn't work, try standard LIKE
                if (employeeQuery.length === 0) {
                  // Escape special characters for LIKE query
                  const likePattern = normalizedContractor.replace(/\./g, '\\.').replace(/%/g, '\\%').replace(/_/g, '\\_');
                  const likeQuery = await zcql.executeZCQLQuery(
                    `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${likePattern}%'`
                  );
                  if (likeQuery && likeQuery.length > 0) {
                    employeeQuery = likeQuery;
                    console.log(`[${userEmail}] Automatic filter - LIKE query found ${likeQuery.length} employees`);
                  }
                }
              } catch (likeError) {
                console.log(`[${userEmail}] Automatic filter - LIKE query failed: ${likeError.message}`);
              }
            }
           
            // Strategy 3: If both failed, try fetching employees with pagination and filtering in JavaScript
            if (employeeQuery.length === 0) {
              try {
                console.log(`[${userEmail}] Automatic filter - Trying to fetch employees with pagination and filter in JavaScript...`);
                // ZCQL has a limit of 300 rows, so we need to use pagination
                let allEmployeesQuery = [];
                let offset = 0;
                const pageSize = 300;
                let hasMore = true;
               
                while (hasMore) {
                  try {
                    const pageQuery = await zcql.executeZCQLQuery(
                      `SELECT EmployeeCode, ContractorName FROM Employee LIMIT ${pageSize} OFFSET ${offset}`
                    );
                    if (pageQuery && pageQuery.length > 0) {
                      allEmployeesQuery.push(...pageQuery);
                      offset += pageSize;
                      if (pageQuery.length < pageSize) {
                        hasMore = false;
                      }
                    } else {
                      hasMore = false;
                    }
                    // Safety limit to prevent infinite loops
                    if (allEmployeesQuery.length > 5000) {
                      console.log(`[${userEmail}] Automatic filter - Reached safety limit of 5000 employees, stopping pagination`);
                      hasMore = false;
                    }
                  } catch (pageError) {
                    console.log(`[${userEmail}] Automatic filter - Pagination error at offset ${offset}: ${pageError.message}`);
                    hasMore = false;
                  }
                }
               
                console.log(`[${userEmail}] Automatic filter - Fetched ${allEmployeesQuery.length} employees for JavaScript filtering`);
               
                // Filter in JavaScript
                const normalizedSearch = normalizedContractor.toLowerCase().trim();
                employeeQuery = allEmployeesQuery.filter(emp => {
                  const empContractor = String(emp.Employee?.ContractorName || '').trim();
                  const empContractorLower = empContractor.toLowerCase();
                 
                  // Try various matching strategies
                  if (empContractorLower === normalizedSearch) return true;
                  if (empContractorLower.includes(normalizedSearch)) return true;
                  if (normalizedSearch.includes(empContractorLower)) return true;
                 
                  // Try matching without dots
                  const empNoDots = empContractorLower.replace(/\./g, '');
                  const searchNoDots = normalizedSearch.replace(/\./g, '');
                  if (empNoDots === searchNoDots || empNoDots.includes(searchNoDots)) return true;
                 
                  // Special handling for Samuel Enterprise/Enterprises variation
                  if (normalizedSearch.includes('samuel') && empContractorLower.includes('samuel')) {
                    // Remove "enterprise" or "enterprises" and compare
                    const empCore = empContractorLower.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
                    const searchCore = normalizedSearch.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
                    if (empCore === searchCore && empCore.includes('samuel')) return true;
                  }
                 
                  return false;
                });
               
                console.log(`[${userEmail}] Automatic filter - JavaScript filtering found ${employeeQuery.length} employees from ${allEmployeesQuery.length} total`);
              } catch (jsError) {
                console.error(`[${userEmail}] Automatic filter - JavaScript filtering failed: ${jsError.message}`);
              }
            }
           
            // Additional JavaScript filtering for better matching
            const normalizedSearch = normalizedContractor.toLowerCase();
            const searchWords = normalizedSearch.split(' ').filter(w => w.length > 2);
           
            const filteredEmployees = employeeQuery.filter(emp => {
              const empContractor = String(emp.Employee?.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
              if (empContractor === normalizedSearch) return true;
              if (empContractor.includes(normalizedSearch) || normalizedSearch.includes(empContractor)) return true;
              if (searchWords.length > 0) {
                const allKeyWordsMatch = searchWords.every(word => empContractor.includes(word));
                if (allKeyWordsMatch) {
                  const firstWord = searchWords[0];
                  const empFirstWord = empContractor.split(' ')[0];
                  if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                    return true;
                  }
                }
              }
             
              // Special handling for Samuel Enterprise/Enterprises variation
              if (normalizedSearch.includes('samuel') && empContractor.includes('samuel')) {
                // Remove "enterprise" or "enterprises" and compare
                const empCore = empContractor.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
                const searchCore = normalizedSearch.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
                if (empCore === searchCore && empCore.includes('samuel')) return true;
              }
             
              // Special handling for Sri Balaji Enterprises (handle extra spaces)
              if (normalizedSearch.includes('balaji') && empContractor.includes('balaji')) {
                // Normalize spaces and compare
                const empNormalized = empContractor.replace(/\s+/g, ' ').trim();
                const searchNormalized = normalizedSearch.replace(/\s+/g, ' ').trim();
                if (empNormalized === searchNormalized) return true;
                // Also try matching core words
                const empWords = empNormalized.split(' ').filter(w => w.length > 2);
                const searchWords = searchNormalized.split(' ').filter(w => w.length > 2);
                if (empWords.length > 0 && searchWords.length > 0) {
                  const commonWords = empWords.filter(w => searchWords.includes(w));
                  if (commonWords.length >= Math.min(2, Math.min(empWords.length, searchWords.length))) {
                    return true;
                  }
                }
              }
             
              return false;
            });
           
            if (filteredEmployees && filteredEmployees.length > 0) {
              employeeIds = filteredEmployees.map(emp => emp.Employee.EmployeeCode).filter(Boolean);
              console.log(`[${userEmail}] Filtering attendance for contractor: ${contractorName}, Employee IDs: ${employeeIds.length} employees found`);
              if (employeeIds.length <= 20) {
                console.log(`[${userEmail}] Employee IDs: ${employeeIds.join(', ')}`);
              }
              // Log sample contractor names found
              const sampleContractors = filteredEmployees.slice(0, 5).map(emp => emp.Employee?.ContractorName).filter(Boolean);
              console.log(`[${userEmail}] Sample contractor names found: ${sampleContractors.join(', ')}`);
            } else {
              console.log(`[${userEmail}] No employees found for contractor: ${contractorName}`);
              // Log what contractor names exist in the database for debugging
              try {
                const allContractorsQuery = await zcql.executeZCQLQuery(
                  `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Samuel%' OR ContractorName LIKE '%samuel%'`
                );
                const allContractors = allContractorsQuery.map(row => row.Employee?.ContractorName).filter(Boolean);
                console.log(`[${userEmail}] Available contractor names with 'Samuel': ${allContractors.join(', ')}`);
              } catch (debugErr) {
                console.error(`[${userEmail}] Error getting debug contractor list:`, debugErr);
              }
              // If no employees found for contractor, return empty result
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ dates, employees: [], muster: [] }));
              return;
            }
          } catch (error) {
            console.error('Error getting employees for contractor:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error getting employees for contractor' }));
            return;
          }
        }
      }
    }

    // Additional contractor filter from request parameters (manual selection)
    if (isContractorManuallySelected) {
      try {
        console.log(`[${userEmail}] Manual contractor selection detected: "${contractor}"`);
       
        // For App Users, if they manually select a contractor, try to normalize it using hardcoded mappings
        // This ensures we use the exact contractor name that matches the Employee table
        let contractorToUse = contractor;
        if (userRole === 'App User' && userEmail) {
          // Check if the selected contractor matches any of the hardcoded mappings
          const emailContractorMap = {
            'afrindinusha@gmail.com': 'R.P.D Facility Management Services',
            'rpdmanpowerservice@gmail.com': 'R.P.D Facility Management Services',
            'ramachandran23488@gmail.com': 'R.P.D Facility Management Services',
            'afrindinusha29@gmail.com': 'Sriram Enterprises',
            'sriramenterprises50@yahoo.com': 'Sriram Enterprises',
            'afrinatlin@gmail.com': 'Samuel Enterprises',
            'samuelenterprisesms@gmail.com': 'Samuel Enterprises',
            'dinushaafrin@gmail.com': 'Sri Balaji Enterprises',
            'vijaybalaji701@gmail.com': 'Sri Balaji Enterprises',
            'afrindinu14@gmail.com': 'Yashaswi Academy for Skills',
            'vaishnavi.a@buildhr.co.in': 'Yashaswi Academy for Skills',
          };
         
          const expectedContractor = emailContractorMap[userEmail];
          if (expectedContractor) {
            // If the selected contractor is a partial match or the user's expected contractor, use the full name
            const normalizedSelected = String(contractor || '').toLowerCase().trim();
            const normalizedExpected = String(expectedContractor || '').toLowerCase().trim();
           
            // Special handling for Samuel Enterprise/Enterprises - try to find actual name from database
            if ((userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") && normalizedSelected.includes('samuel')) {
              try {
                const samuelQuery = await zcql.executeZCQLQuery(
                  `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Samuel%' LIMIT 5`
                );
                if (samuelQuery && samuelQuery.length > 0) {
                  const actualContractorName = samuelQuery[0].Employee?.ContractorName;
                  // Use the actual contractor name from database
                  contractorToUse = actualContractorName;
                  console.log(`[${userEmail}] Found actual Samuel contractor name in database: "${contractorToUse}", using it instead of "${contractor}"`);
                } else if (normalizedSelected.includes(normalizedExpected.substring(0, 10)) ||
                          normalizedExpected.includes(normalizedSelected.substring(0, 10))) {
                  contractorToUse = expectedContractor;
                  console.log(`[${userEmail}] Normalized contractor from "${contractor}" to "${contractorToUse}" based on user email mapping`);
                }
              } catch (samuelError) {
                console.log(`[${userEmail}] Could not find Samuel contractor in database, using provided contractor: ${samuelError.message}`);
                // Fallback to normal matching
                if (normalizedSelected.includes(normalizedExpected.substring(0, 10)) ||
                    normalizedExpected.includes(normalizedSelected.substring(0, 10))) {
                  contractorToUse = expectedContractor;
                  console.log(`[${userEmail}] Normalized contractor from "${contractor}" to "${contractorToUse}" based on user email mapping`);
                }
              }
            } else if ((userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") && normalizedSelected.includes('balaji')) {
              // Special handling for Sri Balaji Enterprises - try to find actual name from database
              try {
                const balajiQuery = await zcql.executeZCQLQuery(
                  `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Balaji%' OR ContractorName LIKE '%balaji%' LIMIT 5`
                );
                if (balajiQuery && balajiQuery.length > 0) {
                  const actualContractorName = balajiQuery[0].Employee?.ContractorName;
                  // Use the actual contractor name from database
                  contractorToUse = actualContractorName;
                  console.log(`[${userEmail}] Found actual Balaji contractor name in database: "${contractorToUse}", using it instead of "${contractor}"`);
                } else if (normalizedSelected.includes(normalizedExpected.substring(0, 10)) ||
                          normalizedExpected.includes(normalizedSelected.substring(0, 10))) {
                  contractorToUse = expectedContractor;
                  console.log(`[${userEmail}] Normalized contractor from "${contractor}" to "${contractorToUse}" based on user email mapping`);
                }
              } catch (balajiError) {
                console.log(`[${userEmail}] Could not find Balaji contractor in database, using provided contractor: ${balajiError.message}`);
                // Fallback to normal matching
                if (normalizedSelected.includes(normalizedExpected.substring(0, 10)) ||
                    normalizedExpected.includes(normalizedSelected.substring(0, 10))) {
                  contractorToUse = expectedContractor;
                  console.log(`[${userEmail}] Normalized contractor from "${contractor}" to "${contractorToUse}" based on user email mapping`);
                }
              }
            } else {
              // Normal matching for other contractors
              if (normalizedSelected.includes(normalizedExpected.substring(0, 10)) ||
                  normalizedExpected.includes(normalizedSelected.substring(0, 10))) {
                contractorToUse = expectedContractor;
                console.log(`[${userEmail}] Normalized contractor from "${contractor}" to "${contractorToUse}" based on user email mapping`);
              }
            }
          }
        }
       
        // Use flexible matching for contractor names
        const normalizedContractor = String(contractorToUse || '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
        console.log(`[${userEmail}] Searching for employees with contractor name: "${normalizedContractor}"`);
       
        // Try multiple query strategies to find employees
        let contractorEmployeeQuery = [];
       
        // Strategy 1: Try exact match first
        try {
          const exactQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${normalizedContractor}'`
          );
          if (exactQuery && exactQuery.length > 0) {
            contractorEmployeeQuery = exactQuery;
            console.log(`[${userEmail}] Exact match query found ${exactQuery.length} employees`);
          }
        } catch (exactError) {
          console.log(`[${userEmail}] Exact match query failed: ${exactError.message}`);
        }
       
            // Strategy 2: If exact match failed, try LIKE query with flexible space matching
            if (contractorEmployeeQuery.length === 0) {
              try {
                // For Balaji, try multiple LIKE patterns to handle extra spaces
                if (normalizedContractor.toLowerCase().includes('balaji')) {
                  // Try pattern that matches any number of spaces
                  const words = normalizedContractor.split(/\s+/).filter(w => w.length > 0);
                  if (words.length >= 2) {
                    // Build pattern like: %Sri%Balaji%Enterprises%
                    const flexiblePattern = words.join('%');
                    const likeQuery = await zcql.executeZCQLQuery(
                      `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${flexiblePattern}%'`
                    );
                    if (likeQuery && likeQuery.length > 0) {
                      contractorEmployeeQuery = likeQuery;
                      console.log(`[${userEmail}] Flexible LIKE query (space-tolerant) found ${likeQuery.length} employees`);
                    }
                  }
                }
               
                // If flexible pattern didn't work, try standard LIKE
                if (contractorEmployeeQuery.length === 0) {
                  // Escape special characters for LIKE query
                  const likePattern = normalizedContractor.replace(/\./g, '\\.').replace(/%/g, '\\%').replace(/_/g, '\\_');
                  const likeQuery = await zcql.executeZCQLQuery(
                    `SELECT EmployeeCode, ContractorName FROM Employee WHERE ContractorName LIKE '%${likePattern}%'`
                  );
                  if (likeQuery && likeQuery.length > 0) {
                    contractorEmployeeQuery = likeQuery;
                    console.log(`[${userEmail}] LIKE query found ${likeQuery.length} employees`);
                  } else {
                    console.log(`[${userEmail}] LIKE query returned 0 employees`);
                  }
                }
              } catch (likeError) {
                console.log(`[${userEmail}] LIKE query failed: ${likeError.message}`);
              }
            }
       
        // Strategy 3: If both failed, try fetching employees with pagination and filtering in JavaScript
        if (contractorEmployeeQuery.length === 0) {
          try {
            console.log(`[${userEmail}] Trying to fetch employees with pagination and filter in JavaScript...`);
            // ZCQL has a limit of 300 rows, so we need to use pagination
            let allEmployeesQuery = [];
            let offset = 0;
            const pageSize = 300;
            let hasMore = true;
           
            while (hasMore) {
              try {
                const pageQuery = await zcql.executeZCQLQuery(
                  `SELECT EmployeeCode, ContractorName FROM Employee LIMIT ${pageSize} OFFSET ${offset}`
                );
                if (pageQuery && pageQuery.length > 0) {
                  allEmployeesQuery.push(...pageQuery);
                  offset += pageSize;
                  if (pageQuery.length < pageSize) {
                    hasMore = false;
                  }
                } else {
                  hasMore = false;
                }
                // Safety limit to prevent infinite loops
                if (allEmployeesQuery.length > 5000) {
                  console.log(`[${userEmail}] Reached safety limit of 5000 employees, stopping pagination`);
                  hasMore = false;
                }
              } catch (pageError) {
                console.log(`[${userEmail}] Pagination error at offset ${offset}: ${pageError.message}`);
                hasMore = false;
              }
            }
           
            console.log(`[${userEmail}] Fetched ${allEmployeesQuery.length} employees for JavaScript filtering`);
           
            // Filter in JavaScript
            const normalizedSearch = normalizedContractor.toLowerCase().trim();
            contractorEmployeeQuery = allEmployeesQuery.filter(emp => {
              const empContractor = String(emp.Employee?.ContractorName || '').trim();
              const empContractorLower = empContractor.toLowerCase();
             
              // Try various matching strategies
              if (empContractorLower === normalizedSearch) return true;
              if (empContractorLower.includes(normalizedSearch)) return true;
              if (normalizedSearch.includes(empContractorLower)) return true;
             
              // Try matching without dots
              const empNoDots = empContractorLower.replace(/\./g, '');
              const searchNoDots = normalizedSearch.replace(/\./g, '');
              if (empNoDots === searchNoDots || empNoDots.includes(searchNoDots)) return true;
             
              // Special handling for Samuel Enterprise/Enterprises variation
              if (normalizedSearch.includes('samuel') && empContractorLower.includes('samuel')) {
                // Remove "enterprise" or "enterprises" and compare
                const empCore = empContractorLower.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
                const searchCore = normalizedSearch.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
                if (empCore === searchCore && empCore.includes('samuel')) return true;
              }
             
              // Special handling for Sri Balaji Enterprises (handle extra spaces)
              if (normalizedSearch.includes('balaji') && empContractorLower.includes('balaji')) {
                // Normalize spaces and compare
                const empNormalized = empContractorLower.replace(/\s+/g, ' ').trim();
                const searchNormalized = normalizedSearch.replace(/\s+/g, ' ').trim();
                if (empNormalized === searchNormalized) return true;
                // Also try matching core words
                const empWords = empNormalized.split(' ').filter(w => w.length > 2);
                const searchWords = searchNormalized.split(' ').filter(w => w.length > 2);
                if (empWords.length > 0 && searchWords.length > 0) {
                  const commonWords = empWords.filter(w => searchWords.includes(w));
                  if (commonWords.length >= Math.min(2, Math.min(empWords.length, searchWords.length))) {
                    return true;
                  }
                }
              }
             
              return false;
            });
           
            console.log(`[${userEmail}] JavaScript filtering found ${contractorEmployeeQuery.length} employees from ${allEmployeesQuery.length} total`);
           
            // Log sample contractor names for debugging
            if (contractorEmployeeQuery.length === 0 && allEmployeesQuery.length > 0) {
              const sampleContractors = allEmployeesQuery.slice(0, 20).map(emp => emp.Employee?.ContractorName).filter(Boolean);
              console.log(`[${userEmail}] Sample contractor names in database: ${sampleContractors.join(', ')}`);
              console.log(`[${userEmail}] Searching for: "${normalizedContractor}" (normalized: "${normalizedSearch}")`);
             
              // Try to find why it's not matching - test first few contractors
              const matchingTests = sampleContractors.slice(0, 5).map(contractorName => {
                const empLower = String(contractorName || '').toLowerCase().trim();
                const exactMatch = empLower === normalizedSearch;
                const includesMatch = empLower.includes(normalizedSearch) || normalizedSearch.includes(empLower);
                const empNoDots = empLower.replace(/\./g, '');
                const searchNoDots = normalizedSearch.replace(/\./g, '');
                const noDotsMatch = empNoDots === searchNoDots || empNoDots.includes(searchNoDots);
                return {
                  contractor: contractorName,
                  empLower: empLower,
                  normalizedSearch: normalizedSearch,
                  exactMatch: exactMatch,
                  includesMatch: includesMatch,
                  noDotsMatch: noDotsMatch,
                  wouldMatch: exactMatch || includesMatch || noDotsMatch
                };
              });
              console.log(`[${userEmail}] Matching test results:`, JSON.stringify(matchingTests, null, 2));
            }
          } catch (jsError) {
            console.error(`[${userEmail}] JavaScript filtering failed: ${jsError.message}`);
          }
        }
       
        console.log(`[${userEmail}] Final query returned ${contractorEmployeeQuery.length} employees`);
       
        // Additional JavaScript filtering for better matching
        const normalizedSearch = normalizedContractor.toLowerCase();
        const searchWords = normalizedSearch.split(' ').filter(w => w.length > 2);
        console.log(`[${userEmail}] Normalized search: "${normalizedSearch}", Search words: [${searchWords.join(', ')}]`);
       
        const filteredEmployees = contractorEmployeeQuery.filter(emp => {
          const empContractor = String(emp.Employee?.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const exactMatch = empContractor === normalizedSearch;
          const includesMatch = empContractor.includes(normalizedSearch) || normalizedSearch.includes(empContractor);
         
          let wordMatch = false;
          if (searchWords.length > 0) {
            const allKeyWordsMatch = searchWords.every(word => empContractor.includes(word));
            if (allKeyWordsMatch) {
              const firstWord = searchWords[0];
              const empFirstWord = empContractor.split(' ')[0];
              if (empFirstWord && (empFirstWord.startsWith(firstWord) || firstWord.startsWith(empFirstWord))) {
                wordMatch = true;
              }
            }
          }
         
          // Special handling for Samuel Enterprise/Enterprises variation
          let samuelMatch = false;
          if (normalizedSearch.includes('samuel') && empContractor.includes('samuel')) {
            // Remove "enterprise" or "enterprises" and compare
            const empCore = empContractor.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
            const searchCore = normalizedSearch.replace(/\s*(enterprise|enterprises)\s*$/i, '').trim();
            if (empCore === searchCore && empCore.includes('samuel')) {
              samuelMatch = true;
            }
          }
         
          // Special handling for Sri Balaji Enterprises (handle extra spaces)
          let balajiMatch = false;
          if (normalizedSearch.includes('balaji') && empContractor.includes('balaji')) {
            // Normalize spaces and compare
            const empNormalized = empContractor.replace(/\s+/g, ' ').trim();
            const searchNormalized = normalizedSearch.replace(/\s+/g, ' ').trim();
            if (empNormalized === searchNormalized) {
              balajiMatch = true;
            } else {
              // Also try matching core words
              const empWords = empNormalized.split(' ').filter(w => w.length > 2);
              const searchWords = searchNormalized.split(' ').filter(w => w.length > 2);
              if (empWords.length > 0 && searchWords.length > 0) {
                const commonWords = empWords.filter(w => searchWords.includes(w));
                if (commonWords.length >= Math.min(2, Math.min(empWords.length, searchWords.length))) {
                  balajiMatch = true;
                }
              }
            }
          }
         
          const matches = exactMatch || includesMatch || wordMatch || samuelMatch || balajiMatch;
         
          // Log first few matches for debugging
          if (contractorEmployeeQuery.indexOf(emp) < 3) {
            console.log(`[${userEmail}] Filter check for "${emp.Employee?.ContractorName}": exact=${exactMatch}, includes=${includesMatch}, word=${wordMatch}, samuel=${samuelMatch}, balaji=${balajiMatch}, final=${matches}`);
          }
         
          return matches;
        });
       
        console.log(`[${userEmail}] After JavaScript filtering: ${filteredEmployees.length} employees matched from ${contractorEmployeeQuery.length} input employees`);
       
        if (filteredEmployees && filteredEmployees.length > 0) {
          const contractorEmployeeIds = filteredEmployees.map(emp => emp.Employee.EmployeeCode).filter(Boolean);
         
          // Log sample contractor names found for debugging
          const sampleContractors = filteredEmployees.slice(0, 10).map(emp => emp.Employee?.ContractorName).filter(Boolean);
          console.log(`[${userEmail}] Sample contractor names found: ${sampleContractors.join(', ')}`);
         
          if (employeeIds.length > 0) {
            // If automatic filter was already applied, intersect with manual selection
            // This handles the case where App User manually selects a different contractor
            const beforeCount = employeeIds.length;
            employeeIds = employeeIds.filter(id => contractorEmployeeIds.includes(id));
            console.log(`[${userEmail}] Intersected automatic filter (${beforeCount} employees) with manual selection (${contractorEmployeeIds.length} employees) -> ${employeeIds.length} employees`);
          } else {
            // No automatic filter applied, use manual selection directly
            employeeIds = contractorEmployeeIds;
            console.log(`[${userEmail}] Using manual contractor selection: ${contractor}, Found ${employeeIds.length} employees`);
          }
         
          if (employeeIds.length <= 20) {
            console.log(`[${userEmail}] Final Employee IDs: ${employeeIds.join(', ')}`);
          } else {
            console.log(`[${userEmail}] Final Employee IDs: ${employeeIds.length} employees (first 10: ${employeeIds.slice(0, 10).join(', ')})`);
          }
        } else {
          // No employees found for manually selected contractor
          console.log(`[${userEmail}] No employees found for manually selected contractor: "${contractor}"`);
         
          // Debug: Show what contractor names exist in the database
          try {
            const debugQuery = await zcql.executeZCQLQuery(
              `SELECT DISTINCT ContractorName FROM Employee LIMIT 50`
            );
            const allContractors = debugQuery.map(row => row.Employee?.ContractorName).filter(Boolean);
            console.log(`[${userEmail}] Available contractor names in Employee table (sample): ${allContractors.slice(0, 20).join(', ')}`);
           
            // Also check if there are similar contractor names
            const similarQuery = await zcql.executeZCQLQuery(
              `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%${normalizedContractor.substring(0, Math.min(10, normalizedContractor.length))}%' LIMIT 20`
            );
            const similarContractors = similarQuery.map(row => row.Employee?.ContractorName).filter(Boolean);
            if (similarContractors.length > 0) {
              console.log(`[${userEmail}] Similar contractor names found: ${similarContractors.join(', ')}`);
            }
          } catch (debugErr) {
            console.error(`[${userEmail}] Error getting debug contractor list:`, debugErr);
          }
         
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            dates,
            employees: [],
            muster: [],
            error: `No employees found for contractor "${contractor}". Please check the contractor name matches exactly with the Employee table.`
          }));
          return;
        }
      } catch (error) {
        console.error(`[${userEmail}] Error applying contractor filter:`, error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Error applying contractor filter: ${error.message}` }));
        return;
      }
    }

    // Department filter
    if (department && department !== 'All') {
      try {
        const departmentEmployeeQuery = await zcql.executeZCQLQuery(
          `SELECT EmployeeCode FROM Employee WHERE Department = '${department}'`
        );
       
        if (departmentEmployeeQuery && departmentEmployeeQuery.length > 0) {
          const departmentEmployeeIds = departmentEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
          if (employeeIds.length > 0) {
            // Intersect with existing employee IDs
            employeeIds = employeeIds.filter(id => departmentEmployeeIds.includes(id));
          } else {
            employeeIds = departmentEmployeeIds;
          }
          console.log(`Department filter applied: ${department}, Employee IDs: ${employeeIds.join(', ')}`);
        }
      } catch (error) {
        console.error('Error applying department filter:', error);
      }
    }

    // Status filter (employeeStatus field in Employee table)
    // IMPORTANT: When status is selected (not "All"), we MUST filter by status
    if (status && status !== 'All') {
      let statusFilterApplied = false;
      try {
        // First, try to get a sample employee to verify field structure (for debugging)
        try {
          const sampleQuery = await zcql.executeZCQLQuery(`SELECT EmployeeCode, employeeStatus, EmployeeStatus FROM Employee LIMIT 1`);
          if (sampleQuery && sampleQuery.length > 0) {
            const sample = sampleQuery[0].Employee;
            console.log('Sample employee fields:', {
              hasEmployeeCode: !!sample.EmployeeCode,
              hasEmployeeStatus: !!sample.employeeStatus,
              hasEmployeeStatusCapital: !!sample.EmployeeStatus,
              employeeStatusValue: sample.employeeStatus,
              EmployeeStatusValue: sample.EmployeeStatus
            });
          }
        } catch (sampleError) {
          console.log('Could not fetch sample employee (non-critical):', sampleError.message);
        }
       
        // Try with lowercase field name first (employeeStatus)
        let statusEmployeeQuery;
        let queryError = null;
        try {
          statusEmployeeQuery = await zcql.executeZCQLQuery(
            `SELECT EmployeeCode FROM Employee WHERE employeeStatus = '${status}'`
          );
          console.log(`Status filter query (employeeStatus) succeeded: ${statusEmployeeQuery?.length || 0} results`);
        } catch (fieldError) {
          queryError = fieldError;
          // If lowercase fails, try with capital E (EmployeeStatus)
          console.log(`employeeStatus field failed, trying EmployeeStatus field name instead`);
          try {
            statusEmployeeQuery = await zcql.executeZCQLQuery(
              `SELECT EmployeeCode FROM Employee WHERE EmployeeStatus = '${status}'`
            );
            console.log(`Status filter query (EmployeeStatus) succeeded: ${statusEmployeeQuery?.length || 0} results`);
            queryError = null;
          } catch (fieldError2) {
            queryError = fieldError2;
            console.error('Error querying employee status with both field name variations:', fieldError2);
          }
        }
       
        if (queryError) {
          throw queryError;
        }
       
        console.log(`Status filter query returned ${statusEmployeeQuery?.length || 0} employees with status: ${status}`);
       
        if (statusEmployeeQuery && statusEmployeeQuery.length > 0) {
          const statusEmployeeIds = statusEmployeeQuery.map(emp => emp.Employee.EmployeeCode);
          console.log(`Found ${statusEmployeeIds.length} employees with status '${status}': ${statusEmployeeIds.slice(0, 10).join(', ')}${statusEmployeeIds.length > 10 ? '...' : ''}`);
         
          if (employeeIds.length > 0) {
            // Intersect with existing employee IDs
            const beforeCount = employeeIds.length;
            employeeIds = employeeIds.filter(id => statusEmployeeIds.includes(id));
            console.log(`Status filter intersection: ${beforeCount} -> ${employeeIds.length} employees`);
          } else {
            employeeIds = statusEmployeeIds;
            console.log(`Status filter set employeeIds to ${employeeIds.length} employees`);
          }
          statusFilterApplied = true;
          console.log(`Status filter applied: ${status}, Total Employee IDs after filter: ${employeeIds.length}`);
        } else {
          // If status filter returns no results, set employeeIds to empty
          employeeIds = [];
          statusFilterApplied = true;
          console.log(`Status filter applied: ${status}, No employees found with this status`);
        }
       
        // If after applying status filter we have no employees, return empty result early
        if (employeeIds.length === 0 && statusFilterApplied) {
          console.log(`No employees found after applying status filter: ${status}, returning empty result`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ dates, employees: [], muster: [], firstIn: [], lastOut: [] }));
          return;
        }
      } catch (error) {
        console.error('Error applying status filter:', error);
        // Status filter is mandatory - if it fails, we should return an error or empty result
        // Don't silently continue without the filter
        console.error(`Status filter failed for '${status}'. This is a required filter - returning error.`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to apply status filter: ${error.message}` }));
        return;
      }
     
      // Safety check: If status was selected but filter wasn't applied, return error
      if (!statusFilterApplied) {
        console.error(`Status filter was requested but not applied for status: ${status}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Status filter could not be applied' }));
        return;
      }
    }

    // Build employee filter condition for queries
    // Note: If employeeIds is empty (no filters applied or status="All" with no other filters),
    // we will fetch all employees. If employeeIds has values (status filter or other filters applied),
    // we will only fetch attendance for those specific employees.
   
    // IMPORTANT: If status was selected (not "All") but employeeIds is empty, this is an error
    if (status && status !== 'All' && employeeIds.length === 0) {
      console.error(`ERROR: Status filter '${status}' was selected but no employees found. This should not happen.`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        dates,
        employees: [],
        muster: [],
        firstIn: [],
        lastOut: [],
        error: `No employees found with status '${status}'. Please check the employee status values in the database.`
      }));
      return;
    }
   
    if (employeeIds.length > 0) {
      const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
      employeeFilterConditions.push(`EmployeeID IN (${employeeIdList})`);
      console.log(`Employee filter condition created with ${employeeIds.length} employee IDs`);
      console.log(`First 10 employee IDs in filter: ${employeeIds.slice(0, 10).join(', ')}`);
    } else {
      console.log('No employee IDs after filtering - will fetch all employees (status="All" or no filters applied)');
    }

    // Fetch BHR (device) transactions - include by default unless explicitly excluded
    let allLogs = [];
    if (source !== 'attendance') {
      let offset = 0;
      const pageSize = 300;
      let hasMore = true;
      while (hasMore) {
        let query = `SELECT EmployeeID, EventTime, DeviceSerial FROM BHR
                     WHERE EventTime >= '${startDate} 00:00:00'
                     AND EventTime <= '${endDate} 23:59:59'`;
        if (employeeFilterConditions.length > 0) {
          query += ` AND ${employeeFilterConditions.join(' AND ')}`;
        }
        query += ` ORDER BY ROWID LIMIT ${pageSize} OFFSET ${offset}`;
        console.log(`BHR Query (offset ${offset}): ${query}`);
        const batch = await zcql.executeZCQLQuery(query);
        const rows = batch.map(r => r.BHR);
        if (rows.length === 0) {
          hasMore = false;
          break;
        }
        allLogs.push(...rows);
        offset += pageSize;
        if (rows.length < pageSize) hasMore = false;
        if (allLogs.length > 20000) break; // safety guard
      }
      console.log(`Fetched ${allLogs.length} BHR records from ESSL server`);
    } else {
      console.log('Skipping BHR fetch; using Attendance table only');
    }

    // Aggregate per EmployeeID + Date using earliest and latest EventTime
    const byKey = {};
    allLogs.forEach(r => {
      const dateStr = r.EventTime.split(' ')[0];
      const key = `${r.EmployeeID}_${dateStr}`;
      if (!byKey[key]) {
        byKey[key] = {
          EmployeeID: r.EmployeeID,
          Date: dateStr,
          FirstIN: r.EventTime,
          LastOUT: r.EventTime,
          Source: 'BHR'
        };
      } else {
        if (r.EventTime < byKey[key].FirstIN) byKey[key].FirstIN = r.EventTime;
        if (r.EventTime > byKey[key].LastOUT) byKey[key].LastOUT = r.EventTime;
      }
    });

    // Also include imported Attendance rows (from Excel) and merge into the same map
    // Only fetch attendance data if source is not 'bhr' only
    let attOffset = 0;
    let attHasMore = true;
    const attPageSize = 300;
    let attendanceRecords = 0;
    let attendanceInRange = 0;

    if (source !== 'bhr') {
      while (attHasMore) {
      // We cannot rely only on AttendanceDate as it may be blank or wrong format.
      // Fetch rows and filter by the effective date derived from FirstIn/LastOut.
      let aQuery = `SELECT EmployeeId, AttendanceDate, FirstIn, LastOut, Status FROM Attendance`;
     
      // Apply employee filter if exists (note: Attendance table uses EmployeeId, not EmployeeID)
      if (employeeFilterConditions.length > 0) {
        const attendanceEmployeeFilter = employeeFilterConditions[0].replace('EmployeeID', 'EmployeeId');
        aQuery += ` WHERE ${attendanceEmployeeFilter}`;
      }
     
      aQuery += ` ORDER BY EmployeeId, AttendanceDate LIMIT ${attPageSize} OFFSET ${attOffset}`;
     
      console.log(`Attendance Query (offset ${attOffset}): ${aQuery}`);
     
      const aBatch = await zcql.executeZCQLQuery(aQuery);
      const aRows = aBatch.map(r => r.Attendance);
      if (aRows.length === 0) {
        attHasMore = false;
        break;
      }
     
      attendanceRecords += aRows.length;
     
      // Helper: normalize time strings, including AM/PM and single-digit hours, return full datetime
      const normalizeTimeForDate = (dateStr, rawVal) => {
        if (!rawVal) return '';
        const raw = String(rawVal).trim();
        // If looks like full datetime already (YYYY-MM-DD), return as is
        if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
        // If looks like DD-MM-YYYY HH:mm[:ss], convert to YYYY-MM-DD
        const dmy = raw.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (dmy) {
          const DD = dmy[1], MM = dmy[2], YYYY = dmy[3];
          const hh = dmy[4], mm = dmy[5], ss = dmy[6] ? dmy[6] : '00';
          return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
        }
        // Match H:MM[:SS][ AM|PM]
        const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
        if (m) {
          let h = parseInt(m[1], 10);
          const mm = m[2];
          const ss = m[3] ? m[3] : '00';
          const ampm = m[4] ? m[4].toUpperCase() : null;
          if (ampm) {
            if (ampm === 'AM' && h === 12) h = 0;
            if (ampm === 'PM' && h < 12) h += 12;
          }
          const HH = String(h).padStart(2, '0');
          return `${dateStr} ${HH}:${mm}:${ss}`;
        }
        // Fallback: if it's only time without seconds (e.g., 9:00), append :00
        if (/^\d{1,2}:\d{2}$/.test(raw)) {
          const [hStr, mStr] = raw.split(':');
          const HH = String(parseInt(hStr, 10)).padStart(2, '0');
          return `${dateStr} ${HH}:${mStr}:00`;
        }
        // As a last resort, try Date parse by combining
        const d = new Date(`${dateStr} ${raw}`);
        if (!isNaN(d)) {
          const HH = String(d.getHours()).padStart(2, '0');
          const MM = String(d.getMinutes()).padStart(2, '0');
          const SS = String(d.getSeconds()).padStart(2, '0');
          return `${dateStr} ${HH}:${MM}:${SS}`;
        }
        return '';
      };

      // Helper: normalize provided status strings from Excel/Attendance table
      const normalizeProvidedStatus = (val) => {
        if (!val) return '';
        const s = String(val).trim().toLowerCase();
        if (s === 'p' || s === 'present' || s === 'full' || s === '1') return 'Present';
        if (s === 'h' || s === 'half' || s === 'half day' || s === '0.5' || s === 'half day present') return 'Half Day Present';
        if (s === 'a' || s === 'absent' || s === '0') return 'Absent';
        return '';
      };

      aRows.forEach(r => {
        // Try to compute a reliable date for the row
        let dateStr = '';
        if (r.AttendanceDate) {
          if (typeof r.AttendanceDate === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(r.AttendanceDate)) {
              dateStr = r.AttendanceDate;
            } else {
              const tmp = new Date(r.AttendanceDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
            }
          } else {
            const tmp = new Date(r.AttendanceDate);
            if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0,10);
          }
        }

        // Normalize FirstIn/LastOut to full datetime strings supporting AM/PM and single-digit hours
        // If dateStr is not available, we will attempt to extract date from FirstIn/LastOut
        const normalizedFirst = dateStr ? normalizeTimeForDate(dateStr, r.FirstIn) : normalizeTimeForDate('1970-01-01', r.FirstIn);
        const normalizedLast = dateStr ? normalizeTimeForDate(dateStr, r.LastOut) : normalizeTimeForDate('1970-01-01', r.LastOut);

        // If dateStr is still empty, try to derive from normalizedFirst/Last (YYYY-MM-DD ...)
        if (!dateStr) {
          const dt = (normalizedFirst || normalizedLast || '').match(/^(\d{4}-\d{2}-\d{2})\s+/);
          if (dt) dateStr = dt[1];
        }

        // Skip if we still don't have a date
        if (!dateStr) return;

        // Filter rows by the requested date range using the derived date
        if (dateStr < startDate || dateStr > endDate) return;
        attendanceInRange++;

        const key = `${r.EmployeeId}_${dateStr}`;
        const providedStatus = normalizeProvidedStatus(r.Status);

        if (!byKey[key]) {
          byKey[key] = {
            EmployeeID: r.EmployeeId,
            Date: dateStr,
            FirstIN: normalizedFirst,
            LastOUT: normalizedLast,
            Source: 'Attendance',
            ProvidedStatus: providedStatus
          };
        } else {
          // Merge with existing BHR data, keeping the earliest FirstIN and latest LastOUT
          if (normalizedFirst && (!byKey[key].FirstIN || normalizedFirst < byKey[key].FirstIN)) {
            byKey[key].FirstIN = normalizedFirst;
          }
          if (normalizedLast && (!byKey[key].LastOUT || normalizedLast > byKey[key].LastOUT)) {
            byKey[key].LastOUT = normalizedLast;
          }
          byKey[key].Source = 'Both'; // Indicates data from both sources
          if (providedStatus && !byKey[key].ProvidedStatus) byKey[key].ProvidedStatus = providedStatus;
        }
      });
        attOffset += attPageSize;
        if (aRows.length < attPageSize) attHasMore = false;
      }

      console.log(`Fetched ${attendanceRecords} Attendance records (${attendanceInRange} in-range)`);
    } else {
      console.log('Skipping Attendance table fetch; using BHR data only');
    }

    // Fetch OnDuty records for the date range
    let ondutyRecords = 0;
    let ondutyInRange = 0;
    try {
      let ondutyOffset = 0;
      let ondutyHasMore = true;
      const ondutyPageSize = 300;

      while (ondutyHasMore) {
        let ondutyQuery = `SELECT EmployeeCode, EmployeeName, NoofHours, Reason, OnDutyDate, FirstIn, Lastout FROM OnDuty`;
       
        // Apply employee filter if exists (OnDuty uses EmployeeCode, which should match EmployeeID)
        if (employeeIds.length > 0) {
          // Convert EmployeeID filter to EmployeeCode filter
          const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
          ondutyQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
        }
       
        ondutyQuery += ` ORDER BY EmployeeCode, OnDutyDate LIMIT ${ondutyPageSize} OFFSET ${ondutyOffset}`;
       
        console.log(`OnDuty Query (offset ${ondutyOffset}): ${ondutyQuery}`);
       
        const ondutyBatch = await zcql.executeZCQLQuery(ondutyQuery);
        const ondutyRows = ondutyBatch.map(r => r.OnDuty);
       
        if (ondutyRows.length === 0) {
          ondutyHasMore = false;
          break;
        }
       
        ondutyRecords += ondutyRows.length;
       
        // Debug: Log first few OnDuty records to see what we're getting from database
        if (ondutyOffset === 0 && ondutyRows.length > 0) {
          console.log(`Sample OnDuty record from database:`, {
            EmployeeCode: ondutyRows[0].EmployeeCode,
            OnDutyDate: ondutyRows[0].OnDutyDate,
            FirstIn: ondutyRows[0].FirstIn,
            Lastout: ondutyRows[0].Lastout,
            FirstInType: typeof ondutyRows[0].FirstIn,
            LastoutType: typeof ondutyRows[0].Lastout
          });
        }
       
        // Helper function to normalize time from OnDuty (similar to normalizeTimeForDate)
        const normalizeOnDutyTime = (dateStr, rawVal) => {
          if (!rawVal) {
            console.log(`normalizeOnDutyTime: rawVal is empty/null for dateStr=${dateStr}`);
            return '';
          }
          const raw = String(rawVal).trim();
          console.log(`normalizeOnDutyTime: input raw="${raw}", dateStr="${dateStr}"`);
         
          // If looks like full datetime already (YYYY-MM-DD HH:mm:ss), return as is
          if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
            console.log(`normalizeOnDutyTime: matched full datetime pattern, returning "${raw}"`);
            return raw;
          }
         
          // If looks like DD-MM-YYYY HH:mm[:ss], convert to YYYY-MM-DD
          const dmy = raw.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
          if (dmy) {
            const DD = dmy[1], MM = dmy[2], YYYY = dmy[3];
            const hh = dmy[4], mm = dmy[5], ss = dmy[6] ? dmy[6] : '00';
            const result = `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
            console.log(`normalizeOnDutyTime: matched DD-MM-YYYY pattern, returning "${result}"`);
            return result;
          }
         
          // Match H:MM[:SS][ AM|PM]
          const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
          if (m) {
            let h = parseInt(m[1], 10);
            const mm = m[2];
            const ss = m[3] ? m[3] : '00';
            const ampm = m[4] ? m[4].toUpperCase() : null;
            if (ampm) {
              if (ampm === 'AM' && h === 12) h = 0;
              if (ampm === 'PM' && h < 12) h += 12;
            }
            const HH = String(h).padStart(2, '0');
            const result = `${dateStr} ${HH}:${mm}:${ss}`;
            console.log(`normalizeOnDutyTime: matched time-only pattern, returning "${result}"`);
            return result;
          }
         
          // Fallback: if it's only time without seconds (e.g., 9:00), append :00
          if (/^\d{1,2}:\d{2}$/.test(raw)) {
            const [hStr, mStr] = raw.split(':');
            const HH = String(parseInt(hStr, 10)).padStart(2, '0');
            const result = `${dateStr} ${HH}:${mStr}:00`;
            console.log(`normalizeOnDutyTime: matched HH:mm pattern, returning "${result}"`);
            return result;
          }
         
          // As a last resort, try Date parse by combining
          try {
            const d = new Date(`${dateStr} ${raw}`);
            if (!isNaN(d.getTime())) {
              const HH = String(d.getHours()).padStart(2, '0');
              const MM = String(d.getMinutes()).padStart(2, '0');
              const SS = String(d.getSeconds()).padStart(2, '0');
              const result = `${dateStr} ${HH}:${MM}:${SS}`;
              console.log(`normalizeOnDutyTime: parsed as Date, returning "${result}"`);
              return result;
            }
          } catch (e) {
            console.log(`normalizeOnDutyTime: Date parse failed: ${e.message}`);
          }
         
          console.log(`normalizeOnDutyTime: ⚠️ No pattern matched, returning empty string for "${raw}"`);
          return '';
        };
       
        ondutyRows.forEach(r => {
          // Normalize OnDutyDate to YYYY-MM-DD format
          // Accepts DD-MM-YYYY, YYYY-MM-DD, and other date formats
          let dateStr = '';
          if (r.OnDutyDate) {
            if (typeof r.OnDutyDate === 'string') {
              const dateStrRaw = String(r.OnDutyDate).trim();
              // If already in YYYY-MM-DD format, use it
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStrRaw)) {
                dateStr = dateStrRaw;
              } else {
                // Check if it's in DD-MM-YYYY format (for OnDuty import/export)
                const dmy = dateStrRaw.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
                if (dmy) {
                  const [, day, month, year] = dmy;
                  dateStr = `${year}-${month}-${day}`;
                  console.log(`OnDuty date converted from DD-MM-YYYY: ${dateStrRaw} -> ${dateStr}`);
                } else {
                  // Try to parse as a date
                  const tmp = new Date(r.OnDutyDate);
                  if (!isNaN(tmp)) {
                    dateStr = tmp.toISOString().slice(0, 10);
                    console.log(`OnDuty date parsed: ${dateStrRaw} -> ${dateStr}`);
                  } else {
                    console.log(`OnDuty date could not be parsed: ${dateStrRaw}`);
                  }
                }
              }
            } else {
              const tmp = new Date(r.OnDutyDate);
              if (!isNaN(tmp)) dateStr = tmp.toISOString().slice(0, 10);
            }
          }
         
          // Skip if we don't have a valid date
          if (!dateStr) {
            console.log(`OnDuty record skipped - no valid date. EmployeeCode: ${r.EmployeeCode}, OnDutyDate: ${r.OnDutyDate}`);
            return;
          }
         
          // Filter rows by the requested date range
          if (dateStr < startDate || dateStr > endDate) {
            console.log(`OnDuty record filtered out - date ${dateStr} not in range ${startDate} to ${endDate}. EmployeeCode: ${r.EmployeeCode}`);
            return;
          }
          ondutyInRange++;
          console.log(`OnDuty record included: EmployeeCode=${r.EmployeeCode}, Date=${dateStr}, DateRange=${startDate} to ${endDate}`);
          console.log(`OnDuty raw FirstIn: "${r.FirstIn}" (type: ${typeof r.FirstIn}), Lastout: "${r.Lastout}" (type: ${typeof r.Lastout}), NoofHours: ${r.NoofHours}`);
         
          // Normalize FirstIn and Lastout times
          let normalizedFirstIn = normalizeOnDutyTime(dateStr, r.FirstIn);
          let normalizedLastOut = normalizeOnDutyTime(dateStr, r.Lastout);
         
          console.log(`After normalizeOnDutyTime - FirstIn: "${normalizedFirstIn}", Lastout: "${normalizedLastOut}"`);
         
          // If times are empty but NoofHours exists, try to calculate default times
          if (!normalizedFirstIn || !normalizedLastOut) {
            console.log(`⚠️ OnDuty times are empty after normalization, using defaults`);
            // Default times: 08:25 to 16:55 (full day)
            const defaultFirstIn = `${dateStr} 08:25:00`;
            const defaultLastOut = `${dateStr} 16:55:00`;
           
            // If NoofHours indicates half day, use 08:25 to 13:00 (half day)
            if (r.NoofHours) {
              const hours = String(r.NoofHours).trim().toLowerCase();
              if (hours === 'half day' || hours === 'halfday' || hours === '0.5') {
                normalizedLastOut = normalizedLastOut || `${dateStr} 13:00:00`;
              }
            }
           
            normalizedFirstIn = normalizedFirstIn || defaultFirstIn;
            normalizedLastOut = normalizedLastOut || defaultLastOut;
           
            console.log(`OnDuty using default times - FirstIn: ${normalizedFirstIn}, Lastout: ${normalizedLastOut}`);
          }
         
          console.log(`OnDuty final normalized FirstIn: "${normalizedFirstIn}", Lastout: "${normalizedLastOut}"`);
         
          // Determine status based on NoofHours
          let ondutyStatus = 'OD'; // Default to OD (On Duty)
          if (r.NoofHours) {
            const hours = String(r.NoofHours).trim().toLowerCase();
            if (hours === 'half day' || hours === 'halfday' || hours === '0.5') {
              ondutyStatus = 'OD-0.5'; // Half Day On Duty
            } else if (hours === 'full day' || hours === 'fullday' || hours === '1') {
              ondutyStatus = 'OD'; // Full Day On Duty
            }
          }
         
          const employeeCode = String(r.EmployeeCode || '').trim();
          if (!employeeCode) return;
         
          const key = `${employeeCode}_${dateStr}`;
         
          // OnDuty Half Day: merge with existing data - use earliest FirstIN (early check-in) and latest LastOUT (late checkout) for LOH/OT and muster display
          const isHalfDay = r.NoofHours && /half\s*day|halfday|0\.5/i.test(String(r.NoofHours).trim());
          if (isHalfDay && byKey[key]) {
            const existing = byKey[key];
            const existingFirst = existing.FirstIN || '';
            const existingLast = existing.LastOUT || '';
            const firstIN = (!existingFirst || (normalizedFirstIn && normalizedFirstIn < existingFirst)) ? (normalizedFirstIn || existingFirst) : existingFirst;
            const lastOUT = (!existingLast || (normalizedLastOut && normalizedLastOut > existingLast)) ? (normalizedLastOut || existingLast) : existingLast;
            byKey[key] = {
              EmployeeID: employeeCode,
              Date: dateStr,
              FirstIN: firstIN,
              LastOUT: lastOUT,
              Source: (existing.Source && existing.Source !== 'OnDuty' ? existing.Source + '+OnDuty' : 'OnDuty'),
              ProvidedStatus: ondutyStatus,
              // Store OnDuty-applied range and real check-in/out for OD (Half Day) two-part display in muster
              OndutyAppliedFirstIN: normalizedFirstIn,
              OndutyAppliedLastOUT: normalizedLastOut,
              RealFirstIN: existingFirst,
              RealLastOUT: existingLast
            };
            console.log(`OnDuty Half Day merged for ${key}: FirstIN=${firstIN} (earliest), LastOUT=${lastOUT} (latest), Status=${ondutyStatus}`);
          } else {
            // Full day OnDuty or no existing record: replace with OnDuty data only
            byKey[key] = {
              EmployeeID: employeeCode,
              Date: dateStr,
              FirstIN: normalizedFirstIn,
              LastOUT: normalizedLastOut,
              Source: 'OnDuty',
              ProvidedStatus: ondutyStatus,
              // OnDuty-applied range (same as FirstIN/LastOUT when no merge)
              OndutyAppliedFirstIN: normalizedFirstIn,
              OndutyAppliedLastOUT: normalizedLastOut
            };
            console.log(`OnDuty record set for ${key}: FirstIN=${normalizedFirstIn}, LastOUT=${normalizedLastOut}, Status=${ondutyStatus}`);
          }
         
          // Debug: Log the final state of the record
          if (byKey[key]) {
            console.log(`OnDuty record final state for ${key}: FirstIN=${byKey[key].FirstIN}, LastOUT=${byKey[key].LastOUT}, Source=${byKey[key].Source}`);
          }
        });
       
        ondutyOffset += ondutyPageSize;
        if (ondutyRows.length < ondutyPageSize) ondutyHasMore = false;
      }
     
      console.log(`Fetched ${ondutyRecords} OnDuty records (${ondutyInRange} in-range)`);
    } catch (ondutyError) {
      console.error('Error fetching OnDuty records:', ondutyError);
      // Continue processing even if OnDuty fetch fails
    }

    // Fetch CompOff records for the date range (using Taken date)
    let compoffRecords = 0;
    let compoffInRange = 0;
    // WO+Comboff=Yes: exclude worked-on day from OT. OT=Yes: whole working hours count as OT.
    const compoffWoExcludeFromOT = new Set(); // employeeCode_workedOnDate when ComboffStatus=Yes and WorkedOn is WO
    const otYesFullHoursKeys = new Set();      // employeeCode_workedOnDate when OT=Yes (whole hours as OT)
    const isWoDate = (dateStr) => {
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const d = new Date(dateStr);
      const day = d.getDay();
      const dom = d.getDate();
      return day === 0 || (day === 6 && dom >= 1 && dom <= 7);
    };
    try {
      let compoffOffset = 0;
      let compoffHasMore = true;
      const compoffPageSize = 300;

      while (compoffHasMore) {
        let compoffQuery = `SELECT EmployeeCode, EmployeeName, WorkedOn, Taken, ComboffStatus, OT FROM Comboff`;
       
        // Apply employee filter if exists (Comboff uses EmployeeCode, which should match EmployeeID)
        if (employeeIds.length > 0) {
          // Convert EmployeeID filter to EmployeeCode filter
          const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
          compoffQuery += ` WHERE EmployeeCode IN (${employeeIdList})`;
        }
       
        compoffQuery += ` ORDER BY EmployeeCode, Taken LIMIT ${compoffPageSize} OFFSET ${compoffOffset}`;
       
        console.log(`CompOff Query (offset ${compoffOffset}): ${compoffQuery}`);
       
        const compoffBatch = await zcql.executeZCQLQuery(compoffQuery);
        const compoffRows = compoffBatch.map(r => r.Comboff);
       
        if (compoffRows.length === 0) {
          compoffHasMore = false;
          break;
        }
       
        compoffRecords += compoffRows.length;
       
        const compoffStatusYes = (v) => (String(v || '').trim().toLowerCase() === 'yes');
        compoffRows.forEach(r => {
          const employeeCode = String(r.EmployeeCode || '').trim();
          if (!employeeCode) return;
          const comboffYes = compoffStatusYes(r.ComboffStatus);
          const otYes = compoffStatusYes(r.OT);
          // Helper function to normalize date to YYYY-MM-DD format
          const normalizeDate = (dateValue) => {
            if (!dateValue) return '';
            if (typeof dateValue === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                return dateValue;
              } else {
                const tmp = new Date(dateValue);
                if (!isNaN(tmp)) return tmp.toISOString().slice(0, 10);
              }
            } else {
              const tmp = new Date(dateValue);
              if (!isNaN(tmp)) return tmp.toISOString().slice(0, 10);
            }
            return '';
          };
         
          // Process WorkedOn date - mark as Present (P)
          let workedOnDateStr = normalizeDate(r.WorkedOn);
          if (workedOnDateStr && workedOnDateStr >= startDate && workedOnDateStr <= endDate) {
          compoffInRange++;
            const workedOnKey = `${employeeCode}_${workedOnDateStr}`;
            if (comboffYes && isWoDate(workedOnDateStr)) compoffWoExcludeFromOT.add(workedOnKey);
            if (otYes) otYesFullHoursKeys.add(workedOnKey);
            const workedOnStatus = 'Present';
            const workedOnFirstIn = `${workedOnDateStr} 08:25:00`;
            const workedOnLastOut = `${workedOnDateStr} 16:55:00`;
           
            // WorkedOn date should show as Present - takes precedence over Attendance but not OnDuty
            if (byKey[workedOnKey]) {
              const currentSource = byKey[workedOnKey].Source || '';
              if (!currentSource.includes('OnDuty')) {
                // Update existing record with Present status
                byKey[workedOnKey].ProvidedStatus = workedOnStatus;
                byKey[workedOnKey].Source = currentSource === 'Both' || currentSource === 'Attendance'
                  ? 'Both+CompOffWorkedOn'
                  : (currentSource || 'CompOffWorkedOn');
                // Set default times if not already set from other sources
                if (!byKey[workedOnKey].FirstIN) {
                  byKey[workedOnKey].FirstIN = workedOnFirstIn;
                }
                if (!byKey[workedOnKey].LastOUT) {
                  byKey[workedOnKey].LastOUT = workedOnLastOut;
                }
              } else {
                // OnDuty already exists, so we keep OnDuty but mark source as including CompOffWorkedOn
                byKey[workedOnKey].Source = currentSource.includes('CompOffWorkedOn') ? currentSource : currentSource + '+CompOffWorkedOn';
              }
            } else {
              // Create new record for WorkedOn date as Present
              byKey[workedOnKey] = {
                EmployeeID: employeeCode,
                Date: workedOnDateStr,
                FirstIN: workedOnFirstIn,
                LastOUT: workedOnLastOut,
                Source: 'CompOffWorkedOn',
                ProvidedStatus: workedOnStatus
              };
            }
          }
         
          // Process Taken date - mark as CO (Comp Off) only when Comboff Status = Yes
          let takenDateStr = normalizeDate(r.Taken);
          if (takenDateStr && takenDateStr >= startDate && takenDateStr <= endDate) {
            compoffInRange++;
            const takenKey = `${employeeCode}_${takenDateStr}`;
            if (comboffYes) compoffWoExcludeFromOT.add(takenKey);
            const defaultFirstIn = `${takenDateStr} 08:25:00`;
            const defaultLastOut = `${takenDateStr} 16:55:00`;
            if (comboffYes) {
            // CompOff records mark the Taken date as CO (Comp Off)
            const compoffStatus = 'CO';
          // CompOff records take precedence over Attendance but not OnDuty
            if (byKey[takenKey]) {
            // Only update if source is not OnDuty (OnDuty takes highest precedence)
              const currentSource = byKey[takenKey].Source || '';
            if (!currentSource.includes('OnDuty')) {
              // Update existing record with CompOff status (CompOff takes precedence over Attendance)
                byKey[takenKey].ProvidedStatus = compoffStatus;
                byKey[takenKey].Source = currentSource === 'Both' || currentSource === 'Attendance'
                ? 'Both+CompOff'
                : (currentSource || 'CompOff');
              // Set default times if not already set from other sources
                if (!byKey[takenKey].FirstIN) {
                  byKey[takenKey].FirstIN = defaultFirstIn;
              }
                if (!byKey[takenKey].LastOUT) {
                  byKey[takenKey].LastOUT = defaultLastOut;
              }
            } else {
              // OnDuty already exists, so we keep OnDuty but mark source as including CompOff
                byKey[takenKey].Source = currentSource.includes('CompOff') ? currentSource : currentSource + '+CompOff';
            }
          } else {
            // Create new record for CompOff with default times
              byKey[takenKey] = {
              EmployeeID: employeeCode,
                Date: takenDateStr,
              FirstIN: defaultFirstIn,
              LastOUT: defaultLastOut,
              Source: 'CompOff',
              ProvidedStatus: compoffStatus
            };
            }
          }
          }
        });
       
        compoffOffset += compoffPageSize;
        if (compoffRows.length < compoffPageSize) compoffHasMore = false;
      }
     
      console.log(`Fetched ${compoffRecords} CompOff records (${compoffInRange} in-range)`);
    } catch (compoffError) {
      console.error('Error fetching CompOff records:', compoffError);
      // Continue processing even if CompOff fetch fails
    }

    // Fetch BioMax records for the date range
    let biomaxRecords = 0;
    let biomaxInRange = 0;
    try {
      let biomaxOffset = 0;
      let biomaxHasMore = true;
      const biomaxPageSize = 300;

      while (biomaxHasMore) {
        let biomaxQuery = `SELECT EmployeeCode, EmployeeName, LogDate FROM BioMax
                          WHERE LogDate >= '${startDate} 00:00:00'
                          AND LogDate <= '${endDate} 23:59:59'`;
       
        // Apply employee filter if exists (BioMax uses EmployeeCode, which should match EmployeeID)
        if (employeeIds.length > 0) {
          const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
          biomaxQuery += ` AND EmployeeCode IN (${employeeIdList})`;
        }
       
        biomaxQuery += ` ORDER BY EmployeeCode, LogDate LIMIT ${biomaxPageSize} OFFSET ${biomaxOffset}`;
       
        console.log(`BioMax Query (offset ${biomaxOffset}): ${biomaxQuery}`);
       
        const biomaxBatch = await zcql.executeZCQLQuery(biomaxQuery);
        const biomaxRows = biomaxBatch.map(r => r.BioMax);
       
        if (biomaxRows.length === 0) {
          biomaxHasMore = false;
          break;
        }
       
        biomaxRecords += biomaxRows.length;
       
        // First, collect all BioMax records and group them by employee-date
        const biomaxByKey = {};
       
        biomaxRows.forEach(r => {
          // Extract date from LogDate (format: YYYY-MM-DD HH:MM:SS)
          let dateStr = '';
          let logDateTime = '';
         
          if (r.LogDate) {
            const logDateStr = String(r.LogDate).trim();
            // Extract date part (YYYY-MM-DD)
            const dateMatch = logDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              dateStr = dateMatch[1];
              logDateTime = logDateStr;
            } else {
              // Try to parse as Date
              const tmp = new Date(r.LogDate);
              if (!isNaN(tmp)) {
                dateStr = tmp.toISOString().slice(0, 10);
                // Format as YYYY-MM-DD HH:MM:SS
                const year = tmp.getFullYear();
                const month = String(tmp.getMonth() + 1).padStart(2, '0');
                const day = String(tmp.getDate()).padStart(2, '0');
                const hour = String(tmp.getHours()).padStart(2, '0');
                const minute = String(tmp.getMinutes()).padStart(2, '0');
                const second = String(tmp.getSeconds()).padStart(2, '0');
                logDateTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
              }
            }
          }
         
          // Skip if we don't have a valid date
          if (!dateStr || !logDateTime) return;
         
          // Filter rows by the requested date range
          if (dateStr < startDate || dateStr > endDate) return;
          biomaxInRange++;
         
          const employeeCode = String(r.EmployeeCode || '').trim();
          if (!employeeCode) return;
         
          const key = `${employeeCode}_${dateStr}`;
         
          // Group BioMax records by employee-date to find earliest and latest
          if (!biomaxByKey[key]) {
            biomaxByKey[key] = {
              EmployeeID: employeeCode,
              Date: dateStr,
              FirstIN: logDateTime,
              LastOUT: logDateTime
            };
          } else {
            // Update FirstIN if this is earlier
            if (logDateTime < biomaxByKey[key].FirstIN) {
              biomaxByKey[key].FirstIN = logDateTime;
            }
            // Update LastOUT if this is later
            if (logDateTime > biomaxByKey[key].LastOUT) {
              biomaxByKey[key].LastOUT = logDateTime;
            }
          }
        });
       
        // Now process grouped BioMax records and calculate status based on total hours
        Object.values(biomaxByKey).forEach(biomaxRec => {
          const key = `${biomaxRec.EmployeeID}_${biomaxRec.Date}`;
         
          // Calculate hours between FirstIN and LastOUT
          let biomaxStatus = 'Absent';
          if (biomaxRec.FirstIN && biomaxRec.LastOUT) {
            const inDate = new Date(biomaxRec.FirstIN.replace(' ', 'T'));
            const outDate = new Date(biomaxRec.LastOUT.replace(' ', 'T'));
           
            if (!isNaN(inDate) && !isNaN(outDate)) {
              const hours = (outDate - inDate) / (1000 * 60 * 60);
             
              // Determine status based on total hours worked:
              // If >= 8 hours, mark as "Present"
              // If >= 4 hours but < 8 hours, mark as "Half Day Present"
              // Otherwise, mark as "Absent"
              if (hours >= 8) {
                biomaxStatus = 'Present';
              } else if (hours >= 4) {
                biomaxStatus = 'Half Day Present';
              }
            }
          }
         
          // BioMax records are used to determine attendance status
          // They take precedence over BHR/Attendance but not over OnDuty/CompOff
          if (byKey[key]) {
            // Only update if source is not OnDuty or CompOff (they take highest precedence)
            const currentSource = byKey[key].Source || '';
            if (!currentSource.includes('OnDuty') && !sourceHasCompOffTakenSegment(currentSource)) {
              // Update existing record with BioMax status
              // BioMax status takes precedence over calculated status from BHR/Attendance
              byKey[key].ProvidedStatus = biomaxStatus;
              byKey[key].Source = currentSource === 'BHR' || currentSource === 'Attendance' || currentSource === 'Both'
                ? (currentSource + '+BioMax')
                : (currentSource || 'BioMax');
             
              // ALWAYS take the EARLIEST FirstIN time between ESSL (BHR) and BioMax
              // Compare both sources and use whichever is earlier
              if (biomaxRec.FirstIN && byKey[key].FirstIN) {
                // Both exist - parse and compare datetime to use the earlier one
                try {
                  const biomaxDate = new Date(biomaxRec.FirstIN.replace(' ', 'T'));
                  const existingDate = new Date(byKey[key].FirstIN.replace(' ', 'T'));
                  if (!isNaN(biomaxDate) && !isNaN(existingDate)) {
                    byKey[key].FirstIN = biomaxDate < existingDate ? biomaxRec.FirstIN : byKey[key].FirstIN;
                  } else {
                    // Fallback to string comparison if date parsing fails
                    byKey[key].FirstIN = biomaxRec.FirstIN < byKey[key].FirstIN ? biomaxRec.FirstIN : byKey[key].FirstIN;
                  }
                } catch (e) {
                  // Fallback to string comparison on error
                  byKey[key].FirstIN = biomaxRec.FirstIN < byKey[key].FirstIN ? biomaxRec.FirstIN : byKey[key].FirstIN;
                }
              } else if (biomaxRec.FirstIN && !byKey[key].FirstIN) {
                // Only BioMax has FirstIN
                byKey[key].FirstIN = biomaxRec.FirstIN;
              } else if (!biomaxRec.FirstIN && byKey[key].FirstIN) {
                // Only existing record has FirstIN - keep it
                // No change needed
              }
             
              // ALWAYS take the LATEST LastOUT time between ESSL (BHR) and BioMax
              // Compare both sources and use whichever is later
              if (biomaxRec.LastOUT && byKey[key].LastOUT) {
                // Both exist - parse and compare datetime to use the later one
                try {
                  const biomaxDate = new Date(biomaxRec.LastOUT.replace(' ', 'T'));
                  const existingDate = new Date(byKey[key].LastOUT.replace(' ', 'T'));
                  if (!isNaN(biomaxDate) && !isNaN(existingDate)) {
                    byKey[key].LastOUT = biomaxDate > existingDate ? biomaxRec.LastOUT : byKey[key].LastOUT;
                  } else {
                    // Fallback to string comparison if date parsing fails
                    byKey[key].LastOUT = biomaxRec.LastOUT > byKey[key].LastOUT ? biomaxRec.LastOUT : byKey[key].LastOUT;
                  }
                } catch (e) {
                  // Fallback to string comparison on error
                  byKey[key].LastOUT = biomaxRec.LastOUT > byKey[key].LastOUT ? biomaxRec.LastOUT : byKey[key].LastOUT;
                }
              } else if (biomaxRec.LastOUT && !byKey[key].LastOUT) {
                // Only BioMax has LastOUT
                byKey[key].LastOUT = biomaxRec.LastOUT;
              } else if (!biomaxRec.LastOUT && byKey[key].LastOUT) {
                // Only existing record has LastOUT - keep it
                // No change needed
              }
            } else {
              // OnDuty/CompOff already exists, so we keep their status but mark source as including BioMax
              byKey[key].Source = currentSource.includes('BioMax') ? currentSource : currentSource + '+BioMax';
            }
          } else {
            // Create new record for BioMax
            byKey[key] = {
              EmployeeID: biomaxRec.EmployeeID,
              Date: biomaxRec.Date,
              FirstIN: biomaxRec.FirstIN,
              LastOUT: biomaxRec.LastOUT,
              Source: 'BioMax',
              ProvidedStatus: biomaxStatus
            };
          }
        });
       
        biomaxOffset += biomaxPageSize;
        if (biomaxRows.length < biomaxPageSize) biomaxHasMore = false;
      }
     
      console.log(`Fetched ${biomaxRecords} BioMax records (${biomaxInRange} in-range)`);
    } catch (biomaxError) {
      console.error('Error fetching BioMax records:', biomaxError);
      // Continue processing even if BioMax fetch fails
    }

    // ========== FETCH REGULARIZATION DATA ==========
    try {
      console.log('Fetching Regularization data...');
      let regularizationRecords = 0;
      let regularizationInRange = 0;
      let regularizationOffset = 0;
      let regularizationHasMore = true;
      const regularizationPageSize = 300;

      while (regularizationHasMore) {
        let regularizationQuery = `SELECT EmployeeCode, EmployeeName, LogDate, FirstIn, LastOut FROM Regularization
                              WHERE LogDate >= '${startDate}'
                              AND LogDate <= '${endDate}'`;
       
        // Apply employee filter if exists (Regularization uses EmployeeCode, which should match EmployeeID)
        if (employeeIds.length > 0) {
          const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
          regularizationQuery += ` AND EmployeeCode IN (${employeeIdList})`;
        }
       
        regularizationQuery += ` ORDER BY EmployeeCode, LogDate LIMIT ${regularizationPageSize} OFFSET ${regularizationOffset}`;
       
        console.log(`Regularization Query (offset ${regularizationOffset}): ${regularizationQuery}`);
       
        const regularizationBatch = await zcql.executeZCQLQuery(regularizationQuery);
        const regularizationRows = regularizationBatch.map(r => r.Regularization);
       
        if (regularizationRows.length === 0) {
          regularizationHasMore = false;
          break;
        }
       
        regularizationRecords += regularizationRows.length;
       
        regularizationRows.forEach(r => {
          // Extract date from LogDate (format: YYYY-MM-DD)
          let dateStr = '';
         
          if (r.LogDate) {
            const logDateStr = String(r.LogDate).trim();
            // Extract date part (YYYY-MM-DD)
            const dateMatch = logDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              dateStr = dateMatch[1];
            } else {
              // Try to parse as Date
              const tmp = new Date(r.LogDate);
              if (!isNaN(tmp)) {
                dateStr = tmp.toISOString().slice(0, 10);
              }
            }
          }
         
          // Skip if we don't have a valid date
          if (!dateStr) return;
         
          // Filter rows by the requested date range
          if (dateStr < startDate || dateStr > endDate) return;
          regularizationInRange++;
         
          const employeeCode = String(r.EmployeeCode || '').trim();
          if (!employeeCode) return;
         
          const key = `${employeeCode}_${dateStr}`;
         
          // Format FirstIn and LastOut to datetime format (YYYY-MM-DD HH:MM:SS)
          // If FirstIn/LastOut are just time (HH:MM), combine with LogDate
          let firstInDateTime = '';
          let lastOutDateTime = '';
         
          if (r.FirstIn) {
            const firstInStr = String(r.FirstIn).trim();
            // If it's just time (HH:MM or HH:MM:SS), combine with LogDate
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(firstInStr)) {
              const timePart = firstInStr.length === 5 ? firstInStr : firstInStr.substring(0, 5);
              firstInDateTime = `${dateStr} ${timePart}:00`.substring(0, 19);
            } else if (firstInStr.includes(' ')) {
              // Already has date and time
              firstInDateTime = firstInStr.substring(0, 19);
            } else {
              // Try to parse as datetime
              const tmp = new Date(firstInStr);
              if (!isNaN(tmp)) {
                const year = tmp.getFullYear();
                const month = String(tmp.getMonth() + 1).padStart(2, '0');
                const day = String(tmp.getDate()).padStart(2, '0');
                const hour = String(tmp.getHours()).padStart(2, '0');
                const minute = String(tmp.getMinutes()).padStart(2, '0');
                const second = String(tmp.getSeconds()).padStart(2, '0');
                firstInDateTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
              }
            }
          }
         
          if (r.LastOut) {
            const lastOutStr = String(r.LastOut).trim();
            // If it's just time (HH:MM or HH:MM:SS), combine with LogDate
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(lastOutStr)) {
              const timePart = lastOutStr.length === 5 ? lastOutStr : lastOutStr.substring(0, 5);
              lastOutDateTime = `${dateStr} ${timePart}:00`.substring(0, 19);
            } else if (lastOutStr.includes(' ')) {
              // Already has date and time
              lastOutDateTime = lastOutStr.substring(0, 19);
            } else {
              // Try to parse as datetime
              const tmp = new Date(lastOutStr);
              if (!isNaN(tmp)) {
                const year = tmp.getFullYear();
                const month = String(tmp.getMonth() + 1).padStart(2, '0');
                const day = String(tmp.getDate()).padStart(2, '0');
                const hour = String(tmp.getHours()).padStart(2, '0');
                const minute = String(tmp.getMinutes()).padStart(2, '0');
                const second = String(tmp.getSeconds()).padStart(2, '0');
                lastOutDateTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
              }
            }
          }

          // Night spill: if LastOut on log date is not after FirstIn (e.g. 08:30 in, 04:00 next morning), roll LastOUT to next day for hours/OT.
          if (firstInDateTime && lastOutDateTime) {
            try {
              const fi = new Date(String(firstInDateTime).substring(0, 19).replace(' ', 'T'));
              const lo = new Date(String(lastOutDateTime).substring(0, 19).replace(' ', 'T'));
              if (!isNaN(fi.getTime()) && !isNaN(lo.getTime()) && lo.getTime() <= fi.getTime()) {
                lo.setDate(lo.getDate() + 1);
                const y = lo.getFullYear();
                const mo = String(lo.getMonth() + 1).padStart(2, '0');
                const da = String(lo.getDate()).padStart(2, '0');
                const h = String(lo.getHours()).padStart(2, '0');
                const min = String(lo.getMinutes()).padStart(2, '0');
                const sec = String(lo.getSeconds()).padStart(2, '0');
                lastOutDateTime = `${y}-${mo}-${da} ${h}:${min}:${sec}`;
              }
            } catch (_) { /* keep lastOutDateTime */ }
          }
         
          // Regularization records should show as "Present" (P) when they exist
          // They take precedence over BHR/Attendance/BioMax but not over OnDuty/CompOff
          if (byKey[key]) {
            // Only update if source is not OnDuty or CompOff (they take highest precedence)
            const currentSource = byKey[key].Source || '';
            if (!currentSource.includes('OnDuty') && !sourceHasCompOffTakenSegment(currentSource)) {
              // Update existing record with Regularization status
              // Regularization always shows as Present
              byKey[key].ProvidedStatus = 'Present';
              byKey[key].Source = currentSource === 'BHR' || currentSource === 'Attendance' || currentSource === 'Both' || currentSource.includes('BioMax')
                ? (currentSource + '+Regularization')
                : (currentSource || 'Regularization');
             
              // Use FirstIn from Regularization if available
              if (firstInDateTime) {
                byKey[key].FirstIN = firstInDateTime;
              }
             
              // Use LastOut from Regularization if available
              if (lastOutDateTime) {
                byKey[key].LastOUT = lastOutDateTime;
              }
            } else {
              // OnDuty/CompOff already exists, so we keep their status but mark source as including Regularization
              byKey[key].Source = currentSource.includes('Regularization') ? currentSource : currentSource + '+Regularization';
            }
          } else {
            // Create new record for Regularization
            byKey[key] = {
              EmployeeID: employeeCode,
              Date: dateStr,
              FirstIN: firstInDateTime || null,
              LastOUT: lastOutDateTime || null,
              Source: 'Regularization',
              ProvidedStatus: 'Present' // Regularization always shows as Present
            };
          }
        });
       
        regularizationOffset += regularizationPageSize;
        if (regularizationRows.length < regularizationPageSize) regularizationHasMore = false;
      }
     
      console.log(`Fetched ${regularizationRecords} Regularization records (${regularizationInRange} in-range)`);
    } catch (regularizationError) {
      console.error('Error fetching Regularization records:', regularizationError);
      // Continue processing even if Regularization fetch fails
    }

    // Get all unique employee IDs from effective in-range map
    let employees = Array.from(new Set(
      Object.values(byKey).map(v => String(v.EmployeeID))
    )).sort((a, b) => String(a).localeCompare(String(b)));

    // Final filter: If we have filtered employeeIds (from status/contractor/department filters),
    // ensure only those employees are included in the final result
    if (employeeIds.length > 0) {
      const employeeIdsSet = new Set(employeeIds.map(id => String(id)));
      const beforeCount = employees.length;
      employees = employees.filter(empId => employeeIdsSet.has(String(empId)));
      console.log(`Final employee filter applied: ${beforeCount} -> ${employees.length} employees (filtered by status/contractor/department)`);
    }

    console.log(`Total unique employees in final result: ${employees.length}`);

    // Fetch employee names and contractors from Employee table
    const employeeInfoMap = {};
    if (employees.length > 0) {
      try {
        // Build query to fetch employee master data for all employees in scope
        const employeeIdList = employees.map(id => `'${id}'`).join(',');
        const employeeInfoQuery = `SELECT EmployeeCode, EmployeeName, ContractorName, Department, DateofJoining, DateofExit FROM Employee WHERE EmployeeCode IN (${employeeIdList})`;
        console.log(`Fetching employee info for ${employees.length} employees`);
       
        const employeeInfoResult = await zcql.executeZCQLQuery(employeeInfoQuery);
       
        // Helper function to format date to YYYY-MM-DD
        const formatDate = (dateVal) => {
          if (!dateVal) return '';
          if (typeof dateVal === 'string') {
                // If already in YYYY-MM-DD format
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
              return dateVal;
                } else {
                  // Try to parse and format
              const d = new Date(dateVal);
                  if (!isNaN(d)) {
                return d.toISOString().slice(0, 10);
                  }
                }
              } else {
                // If it's a Date object or timestamp
            const d = new Date(dateVal);
                if (!isNaN(d)) {
              return d.toISOString().slice(0, 10);
                }
              }
          return '';
        };
       
        employeeInfoResult.forEach(row => {
          const emp = row.Employee;
          if (emp.EmployeeCode) {
            // Format DateofJoining to YYYY-MM-DD if it exists
            const dateOfJoining = formatDate(emp.DateofJoining);
           
            // Format DateofExit to YYYY-MM-DD if it exists
            const dateOfExit = formatDate(emp.DateofExit);
           
            employeeInfoMap[emp.EmployeeCode] = {
              employeeName: emp.EmployeeName || '',
              contractor: emp.ContractorName || '',
              department: emp.Department || '',
              dateOfJoining: dateOfJoining,
              dateOfExit: dateOfExit
            };
          }
        });
       
        console.log(`Fetched employee info for ${Object.keys(employeeInfoMap).length} employees`);
      } catch (error) {
        console.error('Error fetching employee info:', error);
        // Continue with empty map if fetch fails
      }
    }

    // Helper function to check if a date is Sunday
    function isSunday(dateStr) {
      const date = new Date(dateStr);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      return dayOfWeek === 0;
    }

    // Holidays: Setup → Calendar only (no hardcoded dates)
    const calendarHolidaySet = new Set();
    try {
      const holidayQuery = `SELECT CalendarDate FROM Calendar WHERE CalendarDate >= '${startDate}' AND CalendarDate <= '${endDate}'`;
      const holidays = await zcql.executeZCQLQuery(holidayQuery);
      if (holidays && holidays.length > 0) {
        holidays.forEach(row => {
          let holidayDate = row.Calendar?.CalendarDate || row.CalendarDate;
          if (holidayDate) {
            if (holidayDate.includes('T')) {
              holidayDate = holidayDate.split('T')[0];
            } else if (holidayDate.length > 10) {
              holidayDate = holidayDate.substring(0, 10);
            }
            calendarHolidaySet.add(holidayDate);
          }
        });
        console.log(`Loaded ${calendarHolidaySet.size} holiday(s) from Calendar table for date range`);
      }
    } catch (error) {
      console.log('Calendar holiday query failed (no calendar holidays for this range):', error.message);
    }

    function isHoliday(dateStr) {
      return !!(dateStr && calendarHolidaySet.has(dateStr));
    }

    function getStatus(firstIn, lastOut, providedStatus, source) {
      // CompOffWorkedOn should return 'Present' status (highest precedence for WorkedOn dates)
      if (source === 'CompOffWorkedOn' || source?.includes('CompOffWorkedOn')) {
        return 'Present'; // WorkedOn date should always show as Present
      }
     
      // OnDuty status should return 'OD' or 'OD-0.5' (highest precedence)
      if (source === 'OnDuty' || source?.includes('OnDuty')) {
        // If source includes OnDuty, return the OnDuty status (OD or OD-0.5)
        if (providedStatus === 'OD' || providedStatus === 'OD-0.5') {
          return providedStatus;
        }
        // Fallback: if status is not set correctly, return 'OD'
        return 'OD';
      }
     
      // CompOff Taken status takes precedence
      if (providedStatus && (source === 'CompOff' || source === 'Both+CompOff' || source?.includes('CompOff'))) {
        // If source includes CompOff (Taken date) and status is CO, return CO
        if (providedStatus === 'CO') {
          return 'CO';
        }
        return providedStatus;
      }
     
      // Regularization status takes precedence over Attendance/BHR/BioMax calculated status
      // Regularization always shows as Present
      if (source === 'Regularization' || source?.includes('Regularization')) {
        return 'Present'; // Regularization always shows as Present
      }
     
      // BioMax status takes precedence over Attendance/BHR calculated status
      if (providedStatus && (source === 'BioMax' || source?.includes('BioMax'))) {
        return providedStatus;
      }
     
      // If there's a provided status from Attendance table, use it (ignore H — only Calendar defines holidays)
      if (providedStatus) {
        const pu = String(providedStatus).trim().toUpperCase();
        if (pu !== 'H' && pu !== 'HOLIDAY') {
          return providedStatus;
        }
      }
     
      // Otherwise, calculate from FirstIN/LastOUT times
      if (!firstIn || !lastOut) return 'Absent';
      const inDate = new Date(firstIn.replace(' ', 'T'));
      const outDate = new Date(lastOut.replace(' ', 'T'));
      if (isNaN(inDate) || isNaN(outDate)) return 'Absent';
      const hours = (outDate - inDate) / (1000 * 60 * 60);
      // Count >= 4 hours as Present (changed from Half Day Present)
      if (hours >= 4) return 'Present';
      return 'Absent';
    }

    const muster = employees.map(empId => {
      // Get employee's date of joining and date of exit
      const empInfo = employeeInfoMap[empId] || {};
      const dateOfJoining = empInfo.dateOfJoining || '';
      const dateOfExit = empInfo.dateOfExit || '';
     
      // Helper function to normalize dates to YYYY-MM-DD format for comparison
      const normalizeDate = (d) => {
        if (!d) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
        const parsed = new Date(d);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().slice(0, 10);
        }
        return '';
      };
     
      // Helper function to compare dates (returns true if date1 < date2)
      const isDateBefore = (date1, date2) => {
        if (!date1 || !date2) return false;
        const normDate1 = normalizeDate(date1);
        const normDate2 = normalizeDate(date2);
        return normDate1 && normDate2 && normDate1 < normDate2;
      };
     
      // Helper function to compare dates (returns true if date1 > date2)
      const isDateAfter = (date1, date2) => {
        if (!date1 || !date2) return false;
        const normDate1 = normalizeDate(date1);
        const normDate2 = normalizeDate(date2);
        return normDate1 && normDate2 && normDate1 > normDate2;
      };
     
      return dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
       
        // Check if this date is a holiday (check before Sunday/Saturday checks)
        if (isHoliday(date)) {
          // If there's a CompOffWorkedOn record for this date, show 'P' instead of 'H'
          if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
            return 'Present'; // WorkedOn date should show as Present even on holiday
          }
          // If date is before date of joining, don't count as Holiday - show as Absent
          if (dateOfJoining && isDateBefore(date, dateOfJoining)) {
            return 'Absent'; // Before date of joining, don't count H
          }
          // If date is after date of exit, don't count as Holiday - show as Absent
          if (dateOfExit && isDateAfter(date, dateOfExit)) {
            return 'Absent'; // After date of exit, don't count H
          }
          return 'H'; // Holiday (only if not a WorkedOn date and between date of joining and date of exit)
        }
       
        // Check if this date is Sunday
        if (isSunday(date)) {
          // 3/1/2026 (displayed as 03/01/2026): do not show WO; use P or A based on attendance (support both 2026-01-03 and 2026-03-01)
          if (date === '2026-03-01' || date === '2026-01-03') {
            if (!rec) return 'Absent';
            return getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
          }
          // If there's a CompOffWorkedOn record for this date, show 'P' instead of 'WO'
          if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
            return 'Present'; // WorkedOn date should show as Present even on Sunday
          }
          // If date is before date of joining, don't count as Week Off - show as Absent
          if (dateOfJoining && isDateBefore(date, dateOfJoining)) {
            return 'Absent'; // Before date of joining, don't count WO
          }
          // If date is after date of exit, don't count as Week Off - show as Absent
          if (dateOfExit && isDateAfter(date, dateOfExit)) {
            return 'Absent'; // After date of exit, don't count WO
          }
          return 'WO'; // Week Off (only if not a WorkedOn date and between date of joining and date of exit)
        }
       
        if (!rec) return 'Absent';
        return getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
      });
    });

    // Employee-date exclusions: no OT and no First In/Last Out display for these combinations.
    // Format: "employeeId_YYYY-MM-DD". Used for firstIn, lastOut, and OT calculation.
    // Include WO days with Comboff=Yes so those working hours are not added to OT.
    const OT_EXCLUSIONS = new Set([
      '36150_2026-01-04', '60102_2026-01-04', '50059_2025-12-28', '50059_2025-12-14',
      '60060_2026-01-04', '36114_2026-01-04', '50028_2026-01-04', '60112_2026-01-04',
      '36150_2026-01-01'
    ]);
    compoffWoExcludeFromOT.forEach(k => OT_EXCLUSIONS.add(k));

    // Generate firstIn and lastOut arrays for each employee and date
    const firstIn = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (OT_EXCLUSIONS.has(key)) return '';
        if (!rec || !rec.FirstIN) {
          // Debug logging for OnDuty records without FirstIN
          if (rec && rec.Source && rec.Source.includes('OnDuty')) {
            console.log(`⚠️ OnDuty record for ${key} has no FirstIN. Source: ${rec.Source}, FirstIN: ${rec.FirstIN}`);
          }
          return '';
        }
       
        // Extract time from datetime string (format: YYYY-MM-DD HH:mm:ss)
        const firstInStr = String(rec.FirstIN).trim();
       
        // Debug logging for OnDuty records
        if (rec.Source && rec.Source.includes('OnDuty')) {
          console.log(`OnDuty FirstIN extraction for ${key}: raw="${firstInStr}", Source=${rec.Source}`);
        }
       
        // If it's already just time (HH:mm), return it
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(firstInStr)) {
          const timeMatch = firstInStr.match(/^(\d{1,2}):(\d{2})/);
          if (timeMatch) {
            const result = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
            if (rec.Source && rec.Source.includes('OnDuty')) {
              console.log(`OnDuty FirstIN extracted as time-only: ${result}`);
            }
            return result;
          }
        }
       
        // If it's a datetime string, extract time part
        const timePart = firstInStr.split(' ')[1] || '';
        if (timePart) {
          const result = timePart.substring(0, 5); // Return HH:mm format
          if (rec.Source && rec.Source.includes('OnDuty')) {
            console.log(`OnDuty FirstIN extracted from datetime: ${result}`);
          }
          return result;
        }
       
        // Try to parse as Date
        try {
          const dateObj = new Date(firstInStr.replace(' ', 'T'));
          if (!isNaN(dateObj.getTime())) {
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const result = `${hours}:${minutes}`;
            if (rec.Source && rec.Source.includes('OnDuty')) {
              console.log(`OnDuty FirstIN parsed as Date: ${result}`);
            }
            return result;
          }
        } catch (e) {
          // Ignore parse errors
        }
       
        if (rec.Source && rec.Source.includes('OnDuty')) {
          console.log(`⚠️ OnDuty FirstIN could not be extracted for ${key}: "${firstInStr}"`);
        }
        return '';
      })
    );

    const lastOut = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (OT_EXCLUSIONS.has(key)) return '';
        if (!rec || !rec.LastOUT) {
          // Debug logging for OnDuty records without LastOUT
          if (rec && rec.Source && rec.Source.includes('OnDuty')) {
            console.log(`⚠️ OnDuty record for ${key} has no LastOUT. Source: ${rec.Source}, LastOUT: ${rec.LastOUT}`);
          }
          return '';
        }
       
        // Extract time from datetime string (format: YYYY-MM-DD HH:mm:ss)
        const lastOutStr = String(rec.LastOUT).trim();
       
        // Debug logging for OnDuty records
        if (rec.Source && rec.Source.includes('OnDuty')) {
          console.log(`OnDuty LastOUT extraction for ${key}: raw="${lastOutStr}", Source=${rec.Source}`);
        }
       
        // If it's already just time (HH:mm), return it
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(lastOutStr)) {
          const timeMatch = lastOutStr.match(/^(\d{1,2}):(\d{2})/);
          if (timeMatch) {
            const result = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
            if (rec.Source && rec.Source.includes('OnDuty')) {
              console.log(`OnDuty LastOUT extracted as time-only: ${result}`);
            }
            return result;
          }
        }
       
        // If it's a datetime string, extract time part
        const timePart = lastOutStr.split(' ')[1] || '';
        if (timePart) {
          const result = timePart.substring(0, 5); // Return HH:mm format
          if (rec.Source && rec.Source.includes('OnDuty')) {
            console.log(`OnDuty LastOUT extracted from datetime: ${result}`);
          }
          return result;
        }
       
        // Try to parse as Date
        try {
          const dateObj = new Date(lastOutStr.replace(' ', 'T'));
          if (!isNaN(dateObj.getTime())) {
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const result = `${hours}:${minutes}`;
            if (rec.Source && rec.Source.includes('OnDuty')) {
              console.log(`OnDuty LastOUT parsed as Date: ${result}`);
            }
            return result;
          }
        } catch (e) {
          // Ignore parse errors
        }
       
        if (rec.Source && rec.Source.includes('OnDuty')) {
          console.log(`⚠️ OnDuty LastOUT could not be extracted for ${key}: "${lastOutStr}"`);
        }
        return '';
      })
    );

    // Generate source array to identify OnDuty records
    const sources = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec) return '';
        return rec.Source || '';
      })
    );

    // Generate OnDuty FirstIn and LastOut dates (full datetime strings) for display
    const ondutyFirstIn = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        // Only return if source is OnDuty or contains OnDuty
        if (!rec || !rec.Source || (!rec.Source.includes('OnDuty'))) return '';
        if (!rec.FirstIN) return '';
        return rec.FirstIN; // Return full datetime string
      })
    );

    const ondutyLastOut = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        // Only return if source is OnDuty or contains OnDuty
        if (!rec || !rec.Source || (!rec.Source.includes('OnDuty'))) return '';
        if (!rec.LastOUT) return '';
        return rec.LastOUT; // Return full datetime string
      })
    );

    // Helper: extract HH:mm from datetime string for OD Half Day display
    const toTimeOnly = (dtStr) => {
      if (!dtStr || typeof dtStr !== 'string') return '';
      const s = String(dtStr).trim();
      const timePart = s.split(' ')[1] || '';
      if (timePart) return timePart.substring(0, 5);
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.substring(0, 5);
      try {
        const d = new Date(s.replace(' ', 'T'));
        if (!isNaN(d.getTime())) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      } catch (e) { /* ignore */ }
      return '';
    };

    // OnDuty-applied time range (what was entered in OnDuty form) - for OD (Half Day) two-part display
    const ondutyAppliedFirstIn = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec || !rec.Source || !rec.Source.includes('OnDuty')) return '';
        const val = rec.OndutyAppliedFirstIN || rec.FirstIN;
        return toTimeOnly(val);
      })
    );
    const ondutyAppliedLastOut = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec || !rec.Source || !rec.Source.includes('OnDuty')) return '';
        const val = rec.OndutyAppliedLastOUT || rec.LastOUT;
        return toTimeOnly(val);
      })
    );
    // Real check-in/check-out (device/BHR times) - only for OD-0.5 when merged with existing data
    const realFirstIn = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec || !rec.RealFirstIN) return '';
        return toTimeOnly(rec.RealFirstIN);
      })
    );
    const realLastOut = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec || !rec.RealLastOUT) return '';
        return toTimeOnly(rec.RealLastOUT);
      })
    );

    // Generate totalHours array - calculate hours worked from FirstIN and LastOUT
    const totalHours = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec || !rec.FirstIN || !rec.LastOUT) return '';
       
        try {
          const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
          const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
         
          if (isNaN(firstInDate) || isNaN(lastOutDate)) return '';
         
          const diffMs = lastOutDate - firstInDate;
          if (diffMs <= 0) return '';
         
          const totalWorkingHours = diffMs / (1000 * 60 * 60);
          return parseFloat(totalWorkingHours.toFixed(2));
        } catch (error) {
          console.error(`Error calculating total hours for ${empId} on ${date}:`, error);
          return '';
        }
      })
    );

    // Generate employeeNames and contractors arrays (same value repeated for each date per employee)
    const employeeNames = employees.map(empId => {
      const empInfo = employeeInfoMap[empId] || {};
      const name = empInfo.employeeName || '';
      return dates.map(() => name); // Repeat the same name for each date
    });

    const contractors = employees.map(empId => {
      const empInfo = employeeInfoMap[empId] || {};
      const contractor = empInfo.contractor || '';
      return dates.map(() => contractor); // Repeat the same contractor for each date
    });

    const departments = employees.map(empId => {
      const empInfo = employeeInfoMap[empId] || {};
      const dept = empInfo.department || '';
      return dates.map(() => dept); // Repeat the same department for each date
    });

    // Generate dateOfJoining array (same value repeated for each date per employee)
    const dateOfJoining = employees.map(empId => {
      const empInfo = employeeInfoMap[empId] || {};
      const doj = empInfo.dateOfJoining || '';
      return dates.map(() => doj); // Repeat the same date of joining for each date
    });

    // Generate dateOfExit array (same value repeated for each date per employee)
    const dateOfExit = employees.map(empId => {
      const empInfo = employeeInfoMap[empId] || {};
      const doe = empInfo.dateOfExit || '';
      return dates.map(() => doe); // Repeat the same date of exit for each date
    });

    // Fetch shift information from Shiftmap table (legacy) and NewShiftMap table (priority)
    const shiftMap = {}; // Key: empId -> [{ assignedShift, fromdate, todate }]
    try {
      const shiftQuery = `SELECT EmployeeId, AssignedShift, Fromdate, Todate FROM Shiftmap WHERE Fromdate <= '${endDate}' AND Todate >= '${startDate}'`;
      const shiftRecords = await zcql.executeZCQLQuery(shiftQuery);
      for (const row of shiftRecords) {
        const shift = row.Shiftmap;
        const empId = String(shift.EmployeeId || '').trim();
        if (!empId) continue;
       
        // Normalize dates to YYYY-MM-DD format
        const normalizeDate = (dateVal) => {
          if (!dateVal) return '';
          if (typeof dateVal === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
            const d = new Date(dateVal);
            if (!isNaN(d)) return d.toISOString().slice(0, 10);
          } else {
            const d = new Date(dateVal);
            if (!isNaN(d)) return d.toISOString().slice(0, 10);
          }
          return '';
        };
       
        const fromDate = normalizeDate(shift.Fromdate);
        const toDate = normalizeDate(shift.Todate);
        const assignedShift = String(shift.AssignedShift || '').trim().toUpperCase();
       
        // Store shift info for this employee
        if (!shiftMap[empId]) {
          shiftMap[empId] = [];
        }
        shiftMap[empId].push({
          assignedShift: assignedShift,
          fromdate: fromDate,
          todate: toDate
        });
      }
      console.log(`Fetched shift information for ${Object.keys(shiftMap).length} employees`);
    } catch (err) {
      console.error('Error fetching shift information:', err);
      // Continue without shift information if query fails
    }

    // Fetch NewShiftMap data for shift types (priority over Shiftmap)
    const newShiftMap = {}; // Key: "employeeCode_date" -> shiftType
    try {
      console.log(`Attendance Muster: Fetching shift data from NewShiftMap for date range ${startDate} to ${endDate}`);
      let newShiftMapQuery = `SELECT EmployeeCode, ShiftDate, ShiftType FROM NewShiftMap WHERE ShiftDate >= '${startDate}' AND ShiftDate <= '${endDate}'`;

      // Apply employee filter if we have it (reduces payload)
      try {
        if (Array.isArray(employeeIds) && employeeIds.length > 0) {
          const employeeIdList = employeeIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
          newShiftMapQuery += ` AND EmployeeCode IN (${employeeIdList})`;
        }
      } catch (e) {
        // ignore filter build errors
      }

      const pageSize = 300;
      let offset = 0;
      let hasMore = true;
      const allNewShiftRecords = [];

      while (hasMore) {
        try {
          const paginatedQuery = `${newShiftMapQuery} ORDER BY EmployeeCode, ShiftDate LIMIT ${pageSize} OFFSET ${offset}`;
          const batch = await zcql.executeZCQLQuery(paginatedQuery);
          if (!batch || batch.length === 0) {
            hasMore = false;
            break;
          }
          allNewShiftRecords.push(...batch);
          offset += pageSize;
          if (batch.length < pageSize) hasMore = false;
          if (allNewShiftRecords.length > 20000) {
            console.log('Attendance Muster: NewShiftMap safety limit hit (20000), stopping pagination');
            hasMore = false;
          }
        } catch (pagErr) {
          console.log('Attendance Muster: NewShiftMap pagination failed, trying without pagination:', pagErr.message);
          try {
            const rows = await zcql.executeZCQLQuery(newShiftMapQuery);
            allNewShiftRecords.push(...rows);
          } catch (queryErr) {
            console.error('Attendance Muster: Error executing NewShiftMap query without pagination:', queryErr);
          }
          hasMore = false;
        }
      }

      console.log(`Attendance Muster: Fetched ${allNewShiftRecords.length} records from NewShiftMap`);

      for (const row of allNewShiftRecords) {
        const record = row.NewShiftMap || row;
        const empCode = String(record.EmployeeCode || '').trim();
        const shiftDateRaw = String(record.ShiftDate || '').trim();
        const shiftType = String(record.ShiftType || '').trim().toUpperCase();
        if (!empCode || !shiftDateRaw) continue;

        // Normalize date to YYYY-MM-DD format
        let normalizedDate = shiftDateRaw;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDateRaw)) {
          const d = new Date(shiftDateRaw);
          if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            normalizedDate = `${year}-${month}-${day}`;
          }
        }

        const key = `${empCode}_${normalizedDate}`;
        newShiftMap[key] = shiftType;
      }

      console.log(`Attendance Muster: Built NewShiftMap with ${Object.keys(newShiftMap).length} employee-date entries`);
    } catch (err) {
      console.log('Attendance Muster: NewShiftMap query error:', err.message);
      // Continue without NewShiftMap information if query fails
    }

    // Normalize date for NewShiftMap key compare
    const normalizeDateForCompare = (dateVal) => {
      if (!dateVal) return '';
      if (typeof dateVal === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
        const ddmmyyyyMatch = dateVal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (ddmmyyyyMatch) {
          const [, day, month, year] = ddmmyyyyMatch;
          return `${year}-${month}-${day}`;
        }
      }
      return String(dateVal);
    };

    // Shift type classifier used for UI coloring
    const classifyShiftType = (rawType) => {
      const t = String(rawType || '').trim().toUpperCase();
      const compact = t.replace(/\s+/g, '');
      if (!t) return 'GENERAL';
      if (
        t === 'HOUSEKEEPING' || t === 'HOUSEKEEPING SHIFT' || t === 'HOUSE KEEPING' || t === 'HK' ||
        t.includes('HOUSEKEEPING') || compact.includes('HOUSEKEEPING')
      ) return 'HOUSEKEEPING';
      if (t === '1ST' || t === '1ST SHIFT' || t === 'FIRST' || t === 'FIRST SHIFT' || t === '1' || t === 'SHIFT 1' || t.includes('1ST') || t.includes('FIRST')) {
        return 'FIRST';
      }
      if (t === '2ND' || t === '2ND SHIFT' || t === 'SECOND' || t === 'SECOND SHIFT' || t === '2' || t === 'SHIFT 2' || t.includes('2ND') || t.includes('SECOND')) {
        return 'SECOND';
      }
      // General II: 12:00-20:00, 10 min grace, OT after 21:00
      if (t === 'GENERAL II' || t === 'GENERALII' || compact.includes('GENERALII') || (t.includes('GENERAL') && t.includes('II'))) {
        return 'GENERAL_II';
      }
      return 'GENERAL';
    };

    const getShiftTypeForDate = (empId, dateStr) => {
      const emp = String(empId || '').trim();
      const date = normalizeDateForCompare(dateStr);
      const newKey = `${emp}_${date}`;
      const fromNew = newShiftMap[newKey];
      if (fromNew) return classifyShiftType(fromNew);

      // Fallback to Shiftmap assignment for that date
      if (!shiftMap[emp] || shiftMap[emp].length === 0) return 'GENERAL';

      // Find any shift entry covering this date; prefer explicit non-general shifts
      let foundGeneral = false;
      for (const shift of shiftMap[emp]) {
        const s = String(shift.assignedShift || '').trim().toUpperCase();
        const inRange =
          (shift.fromdate && shift.todate && dateStr >= shift.fromdate && dateStr <= shift.todate) ||
          (shift.fromdate && !shift.todate && dateStr >= shift.fromdate) ||
          (!shift.fromdate && shift.todate && dateStr <= shift.todate) ||
          (!shift.fromdate && !shift.todate);
        if (!inRange) continue;

        const cls = classifyShiftType(s);
        if (cls === 'GENERAL') foundGeneral = true;
        else return cls;
      }
      return foundGeneral ? 'GENERAL' : 'GENERAL';
    };

    const isHousekeepingShift = (empId, dateStr) => getShiftTypeForDate(empId, dateStr) === 'HOUSEKEEPING';
    const isGeneralIIShift = (empId, dateStr) => getShiftTypeForDate(empId, dateStr) === 'GENERAL_II';

    // General shift: check NewShiftMap first, then fallback to Shiftmap
    // OR if employee has GENERAL shift explicitly assigned in shiftmap
    // OR if employee is in shiftmap but doesn't have 1st or 2nd shift for this date
    const isGeneralShift = (empId, dateStr) => {
      // NewShiftMap has priority
      const normalizedEmpId = String(empId).trim();
      const normalizedDate = normalizeDateForCompare(dateStr);
      const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
      const newShiftType = newShiftMap[newShiftKey];
      if (newShiftType) {
        const cls = classifyShiftType(newShiftType);
        return cls === 'GENERAL';
      }

      // If employee is not in shiftmap at all, default to general shift
      if (!shiftMap[empId] || shiftMap[empId].length === 0) return true;
     
      // Check if employee has GENERAL shift explicitly assigned (case-insensitive)
      for (const shift of shiftMap[empId]) {
        const shiftName = String(shift.assignedShift || '').trim().toUpperCase();
        if (shiftName === 'GENERAL' || shiftName === 'GENERAL SHIFT') {
          // Check if date is within the shift date range
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
              return true;
            }
          } else if (shift.fromdate && dateStr >= shift.fromdate) {
            return true;
          } else if (shift.todate && dateStr <= shift.todate) {
            return true;
          }
        }
      }
     
      // If employee is in shiftmap but doesn't have 1st or 2nd shift for this date, default to general
      const hasFirstShift = isFirstShift(empId, dateStr);
      const hasSecondShift = isSecondShift(empId, dateStr);
     
      // If they don't have 1st or 2nd shift, default to general
      return !hasFirstShift && !hasSecondShift;
    };
   
    // Helper function to check if employee is on 1st shift for a specific date
    const isFirstShift = (empId, dateStr) => {
      // NewShiftMap has priority
      const normalizedEmpId = String(empId).trim();
      const normalizedDate = normalizeDateForCompare(dateStr);
      const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
      const newShiftType = newShiftMap[newShiftKey];
      if (newShiftType) {
        return classifyShiftType(newShiftType) === 'FIRST';
      }

      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      // Check if any shift mapping covers this date and is 1st shift
      for (const shift of shiftMap[empId]) {
        // Check for various 1st shift naming patterns (case-insensitive)
        const shiftName = String(shift.assignedShift || '').trim();
        const shiftNameUpper = shiftName.toUpperCase();
        if (shiftNameUpper === '1ST' || shiftNameUpper === '1ST SHIFT' || shiftNameUpper === 'FIRST' ||
            shiftNameUpper === 'FIRST SHIFT' || shiftName === '1' || shiftNameUpper === 'SHIFT 1' ||
            shiftName === '1st Shift') {
          // Check if date is within the shift date range
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
              return true;
            }
          } else if (shift.fromdate && dateStr >= shift.fromdate) {
            return true;
          } else if (shift.todate && dateStr <= shift.todate) {
            return true;
          }
        }
      }
      return false;
    };
   
    // Helper function to check if employee is on 2nd shift for a specific date
    const isSecondShift = (empId, dateStr) => {
      // NewShiftMap has priority
      const normalizedEmpId = String(empId).trim();
      const normalizedDate = normalizeDateForCompare(dateStr);
      const newShiftKey = `${normalizedEmpId}_${normalizedDate}`;
      const newShiftType = newShiftMap[newShiftKey];
      if (newShiftType) {
        return classifyShiftType(newShiftType) === 'SECOND';
      }

      if (!shiftMap[empId] || shiftMap[empId].length === 0) return false;
      // Check if any shift mapping covers this date and is 2nd shift
      for (const shift of shiftMap[empId]) {
        // Check for various 2nd shift naming patterns (case-insensitive)
        const shiftName = String(shift.assignedShift || '').trim();
        const shiftNameUpper = shiftName.toUpperCase();
        if (shiftNameUpper === '2ND' || shiftNameUpper === '2ND SHIFT' || shiftNameUpper === 'SECOND' ||
            shiftNameUpper === 'SECOND SHIFT' || shiftName === '2' || shiftNameUpper === 'SHIFT 2' ||
            shiftName === '2nd Shift') {
          // Check if date is within the shift date range
          if (shift.fromdate && shift.todate) {
            if (dateStr >= shift.fromdate && dateStr <= shift.todate) {
              return true;
            }
          } else if (shift.fromdate && dateStr >= shift.fromdate) {
            return true;
          } else if (shift.todate && dateStr <= shift.todate) {
            return true;
          }
        }
      }
      return false;
    };

    // Shift types matrix for UI coloring (employees x dates)
    const shiftTypes = employees.map(empId =>
      dates.map(date => getShiftTypeForDate(empId, date))
    );
   
    // Helper function to parse time string to minutes
    const parseTime = (timeStr) => {
      if (!timeStr) return null;
      // Extract time part if it's a datetime string
      let timePart = timeStr;
      if (timeStr.includes(' ')) {
        timePart = timeStr.split(' ')[1];
      }
      const parts = timePart.split(':');
      if (parts.length < 2) return null;
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (isNaN(hours) || isNaN(minutes)) return null;
      return hours * 60 + minutes; // Return total minutes
    };

    const minutesToTimeStr = (totalMinutes) => {
      if (typeof totalMinutes !== 'number' || isNaN(totalMinutes)) return '';
      const h = Math.floor(totalMinutes / 60) % 24;
      const m = Math.floor(totalMinutes % 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // Helper function to calculate LOH for any shift with grace period
    // Parameters: firstInTime, lastOutTime, shiftStart (minutes), shiftEnd (minutes), gracePeriodEnd (minutes)
    // Returns: { shouldCalculate: boolean, lohHours: number }
    const calculateLOHForShift = (firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd) => {
      const firstInMinutes = parseTime(firstInTime);
      const lastOutMinutes = parseTime(lastOutTime);
     
      if (firstInMinutes === null || lastOutMinutes === null) {
        return null;
      }
     
      // Only consider time within shift window. Ignore anything before shift start
      // Clamp arrival time to shift start minimum (if before shift start, treat as shift start for calculation)
      const clampedFirstInMinutes = Math.max(firstInMinutes, shiftStart);
     
      // Rule 1: If check-in is between shiftStart-gracePeriodEnd (inclusive) AND check-out is at or after shiftEnd → NO LOH
      if (clampedFirstInMinutes >= shiftStart && clampedFirstInMinutes <= gracePeriodEnd && lastOutMinutes >= shiftEnd) {
        return { shouldCalculate: false, lohHours: 0 };
      }
     
      // Calculate LOH based on time outside effective work period
      let lossOfMinutes = 0;
     
      // Late arrival: if check-in is after grace period, calculate LOH from shift start time to check-in time
      if (clampedFirstInMinutes > gracePeriodEnd) {
        lossOfMinutes += (clampedFirstInMinutes - shiftStart);
      }
     
      // Early departure: if check-out is before shift end, add time from check-out to shift end
      // NOTE: Only count early departure if employee leaves BEFORE shift end time
      if (lastOutMinutes < shiftEnd) {
        lossOfMinutes += (shiftEnd - lastOutMinutes);
      }
     
      // Convert to hours
      const lohHours = lossOfMinutes > 0 ? lossOfMinutes / 60 : 0;
     
      return { shouldCalculate: lohHours > 0, lohHours: lohHours };
    };

    // Helper function to calculate LOH for general shift (8:25-16:55) with 10 min grace (8:25-8:35)
    const calculateLOHForGeneralShift = (firstInTime, lastOutTime) => {
      const shiftStart = 8 * 60 + 25; // 08:25 = 505 minutes
      const shiftEnd = 16 * 60 + 55; // 16:55 = 1015 minutes
      const gracePeriodEnd = 8 * 60 + 35; // 08:35 = 515 minutes (10 min grace)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to calculate LOH for 1st shift (6:00-14:00) with 10 min grace (6:00-6:10)
    const calculateLOHForFirstShift = (firstInTime, lastOutTime) => {
      const shiftStart = 6 * 60 + 0; // 06:00 = 360 minutes
      const shiftEnd = 14 * 60 + 0; // 14:00 = 840 minutes
      const gracePeriodEnd = 6 * 60 + 10; // 06:10 = 370 minutes (10 min grace)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to calculate LOH for 2nd shift (14:00-22:00) with 10 min grace (14:00-14:10)
    const calculateLOHForSecondShift = (firstInTime, lastOutTime) => {
      const shiftStart = 14 * 60 + 0; // 14:00 = 840 minutes
      const shiftEnd = 22 * 60 + 0; // 22:00 = 1320 minutes
      const gracePeriodEnd = 14 * 60 + 10; // 14:10 = 850 minutes (10 min grace)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to calculate LOH for General II shift (12:00-20:00) with 10 min grace
    // Check-in grace: 12:00-12:10. Checkout grace: leaving by 20:10 is on-time (no LOH).
    // Early departure LOH uses actual shift end 20:00 (not 20:10) so e.g. 14:10 checkout = 5h50m LOH, not 6h.
    const calculateLOHForGeneralIIShift = (firstInTime, lastOutTime) => {
      const shiftStart = 12 * 60 + 0; // 12:00 = 720 minutes
      const shiftEnd = 20 * 60 + 0; // 20:00 = 1200 minutes (actual shift end for early-departure LOH)
      const gracePeriodEnd = 12 * 60 + 10; // 12:10 = 730 minutes (10 min grace for check-in)
      // Use shiftEnd 20:00 for LOH; Rule 1 no-LOH applies when lastOut >= 20:00 (grace 20:00-20:10 = OK)
      return calculateLOHForShift(firstInTime, lastOutTime, shiftStart, shiftEnd, gracePeriodEnd);
    };

    // Helper function to check if a date should be excluded from LOH calculation
    const isDateExcludedFromLOH = (dateStr) => {
      // Normalize date to YYYY-MM-DD format
      let normalizedDate = '';
      if (typeof dateStr === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          normalizedDate = dateStr;
        } else {
          const d = new Date(dateStr);
          if (!isNaN(d)) {
            normalizedDate = d.toISOString().slice(0, 10);
          }
        }
      } else {
        const d = new Date(dateStr);
        if (!isNaN(d)) {
          normalizedDate = d.toISOString().slice(0, 10);
        }
      }
     
      // Dates to exclude from LOH calculation
      const excludedDates = [
        '2025-11-30',
        '2025-12-06',
        '2025-12-07',
        '2025-12-14',
        '2025-12-21'
      ];
     
      return excludedDates.includes(normalizedDate);
    };

    // LOH-adjusted first-in for display: round to next 30-min clock boundaries (:00 or :30), not shiftStart+30/60
    // e.g. grace ends 8:35 → 8:35-9:00 -> 9:00; 9:01-9:30 -> 9:30; after 9:31 use actual
    const LOH_GRACE_MINUTES = 10;
    const shiftStartByType = { GENERAL: 8 * 60 + 25, FIRST: 6 * 60 + 0, SECOND: 14 * 60 + 0, GENERAL_II: 12 * 60 + 0 };
    const lohFirstIn = employees.map((empId, empIdx) =>
      dates.map((date, dateIdx) => {
        const firstInTime = firstIn[empIdx] && firstIn[empIdx][dateIdx] ? firstIn[empIdx][dateIdx] : '';
        const lastOutTime = lastOut[empIdx] && lastOut[empIdx][dateIdx] ? lastOut[empIdx][dateIdx] : '';
        if (!firstInTime) return '';
        const shiftType = getShiftTypeForDate(empId, date);
        if (shiftType === 'HOUSEKEEPING') return '';
        const shiftStart = shiftStartByType[shiftType] ?? shiftStartByType.GENERAL;
        const gracePeriodEnd = shiftStart + LOH_GRACE_MINUTES;
        const firstInMinutes = parseTime(firstInTime);
        if (firstInMinutes === null) return firstInTime;
        if (firstInMinutes < shiftStart) return firstInTime;
        if (firstInMinutes <= gracePeriodEnd) return firstInTime;
        const bucket1End = Math.ceil(gracePeriodEnd / 30) * 30;
        const bucket2End = bucket1End + 30;
        if (firstInMinutes <= bucket1End) return minutesToTimeStr(bucket1End);
        if (firstInMinutes <= bucket2End) return minutesToTimeStr(bucket2End);
        return firstInTime;
      })
    );
    const lohLastOut = lastOut; // LOH uses original last-out (no rounding)

    // LOH data must be fetched from reports_function only (same as LOH Report page)
    const lohReportMap = {}; // Map: employeeId_date -> LOH hours
   
    // Helper function to fetch LOH from reports_function
    const fetchLOHFromReportsFunction = () => {
      return new Promise((resolve, reject) => {
    try {
          console.log('=== FETCHING LOH DATA FROM REPORTS FUNCTION ===');
         
          // Build query parameters (same as LOHReport.js frontend)
          const queryParams = new URLSearchParams();
          queryParams.set('startDate', startDate);
          queryParams.set('endDate', endDate);
          if (contractor && contractor !== 'All') {
            queryParams.set('contractor', contractor);
          }
          if (department && department !== 'All') {
            queryParams.set('department', department);
          }
          // Filter by employeeId if we have a specific list (similar to reports_function)
          // Note: reports_function accepts a single employeeId, but we can filter the results
          if (userEmail) {
            queryParams.set('userEmail', userEmail);
          }
          if (userRole) {
            queryParams.set('userRole', userRole);
          }
          // Grace (minutes) - same as LOH report; default 10 if not provided
          const graceParam = String(url.searchParams.get('grace') || '').trim() || '10';
          queryParams.set('grace', graceParam);
         
          // Build the URL for calling reports_function
          // In Catalyst, functions can be called via their function URLs
          // Try to construct the URL from environment or use the request context
          let baseUrl = '';
         
          // Try to get from environment variables (Catalyst provides these)
          if (process.env.CATALYST_FUNCTION_URL) {
            baseUrl = process.env.CATALYST_FUNCTION_URL.replace(/\/$/, '');
          } else if (process.env.CATALYST_ORG_ID) {
            // Construct from org ID: https://{org-id}.functions.zoho.com
            baseUrl = `https://${process.env.CATALYST_ORG_ID}.functions.zoho.com`;
          } else if (req.headers.host) {
            // Use the same host as the current request
            baseUrl = `https://${req.headers.host}`;
          } else {
            // Last resort: try to extract from request URL
            const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
          }
         
          const path = `/server/reports_function/loh?${queryParams.toString()}`;
          const fullUrl = `${baseUrl}${path}`;
          console.log(`Fetching LOH from reports_function: ${fullUrl}`);
         
          // Use URL constructor instead of url.parse (for modern Node.js)
          let hostname, port, requestPath, client;
          try {
            const parsedUrl = new URL(fullUrl);
            hostname = parsedUrl.hostname;
            port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
            requestPath = parsedUrl.pathname + parsedUrl.search;
            client = parsedUrl.protocol === 'https:' ? https : http;
          } catch (e) {
            // Fallback: try to parse manually if URL constructor fails
            console.log('URL constructor failed, using manual parsing:', e.message);
            const urlMatch = fullUrl.match(/^(https?):\/\/([^\/:]+)(?::(\d+))?(\/.*)?$/);
            if (urlMatch) {
              hostname = urlMatch[2];
              port = urlMatch[3] || (urlMatch[1] === 'https' ? 443 : 80);
              requestPath = urlMatch[4] || '/';
              client = urlMatch[1] === 'https' ? https : http;
            } else {
              console.error('Failed to parse URL:', fullUrl);
              throw new Error('Invalid URL format: ' + fullUrl);
            }
          }
         
          const options = {
            hostname: hostname,
            port: port,
            path: requestPath,
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Catalyst-AttendanceMusterFunction/1.0'
            },
            timeout: 10000
          };
         
          const reqHttp = client.request(options, (resHttp) => {
            let data = '';
           
            resHttp.on('data', (chunk) => {
              data += chunk;
            });
           
            resHttp.on('end', () => {
              try {
                if (resHttp.statusCode === 200) {
                  const result = JSON.parse(data);
                  const lohData = result.data || [];
                 
                  console.log(`Successfully fetched ${lohData.length} LOH records from reports_function`);
                 
                  // Process LOH data from reports_function (same format as LOHReport.js)
                  // Filter by employees list if we have one
                  const employeeSet = employees.length > 0 ? new Set(employees.map(String)) : null;
                 
                  for (const row of lohData) {
                    const empId = String(row.employeeId || '').trim();
                    if (!empId) continue;
                   
                    // Filter by employees list if we have one
                    if (employeeSet && !employeeSet.has(empId)) {
                      continue;
                    }
                   
                    // Normalize date to YYYY-MM-DD format (same as dates array)
                    let lohDate = row.date || '';
                    if (lohDate) {
                      // Ensure date is in YYYY-MM-DD format
                      if (typeof lohDate === 'string') {
                        if (/^\d{4}-\d{2}-\d{2}$/.test(lohDate)) {
                          // Already in correct format
                        } else {
                          // Try to parse and normalize
                          const d = new Date(lohDate);
                          if (!isNaN(d)) {
                            lohDate = d.toISOString().slice(0, 10);
                          }
                        }
                      }
                    }
                    if (!lohDate) continue;
                   
                    // IMPORTANT: Only include LOH data for dates within the selected date range
                    // This ensures that LOH data is correctly filtered to match the payroll date range
                    if (lohDate < startDate || lohDate > endDate) {
                      continue; // Skip dates outside the selected range
                    }
                   
                    // Convert lossOfHours to number
                    // IMPORTANT: Include 0.00 values (grace period cases) - LOH report includes them in total
                    const lohHours = parseFloat(row.lossOfHours || '0');
                   
                    // Store all values including 0.00 (same as LOH report does)
                    // This ensures the total calculation matches LOH report exactly
                    if (!isNaN(lohHours)) {
                      const key = `${empId}_${lohDate}`;
                      lohReportMap[key] = lohHours;
                     
                      // Debug logging for employee 32001
                      if (empId === '32001') {
                        console.log(`LOH Report Data for 32001: date=${lohDate}, lohHours=${lohHours}, key=${key}`);
                      }
                    }
                  }
                 
                  console.log(`Loaded ${Object.keys(lohReportMap).length} LOH entries from reports_function`);
                  // Debug: Show sample keys for employee 32001
                  const keys32001 = Object.keys(lohReportMap).filter(k => k.startsWith('32001_'));
                  if (keys32001.length > 0) {
                    console.log(`Sample keys for 32001: ${keys32001.slice(0, 5).join(', ')}`);
                  }
                  resolve(lohReportMap);
                } else {
                  console.log(`Reports function returned status ${resHttp.statusCode}; LOH from reports only, no fallback`);
                  resolve(null);
                }
              } catch (parseError) {
                console.error('Error parsing reports_function response:', parseError);
                resolve(null); // LOH from reports_function only; no fallback
              }
            });
          });
         
          reqHttp.on('error', (error) => {
            console.error('Error fetching LOH from reports_function (LOH from reports only, no fallback):', error.message);
            resolve(null);
          });
         
          reqHttp.setTimeout(10000, () => {
            reqHttp.destroy();
            console.log('Timeout fetching LOH from reports_function; LOH from reports only, no fallback');
            resolve(null);
          });
         
          reqHttp.end();
        } catch (err) {
          console.error('Error in fetchLOHFromReportsFunction:', err);
          resolve(null); // LOH from reports_function only; no fallback
        }
      });
    };
   
    // Step 1: Try to fetch from reports_function
    try {
      const reportsResult = await fetchLOHFromReportsFunction();
      if (reportsResult && Object.keys(lohReportMap).length > 0) {
        console.log(`✅ Using LOH data from reports_function (${Object.keys(lohReportMap).length} entries)`);
        // Debug: Check if employee 32001 data is present
        const keys32001 = Object.keys(lohReportMap).filter(k => k.startsWith('32001_'));
        if (keys32001.length > 0) {
          console.log(`✅ Employee 32001 LOH data found: ${keys32001.length} entries`);
          keys32001.slice(0, 3).forEach(k => {
            console.log(`  - ${k}: ${lohReportMap[k]}`);
          });
        } else {
          console.log(`⚠️ Employee 32001 LOH data NOT found in reports_function data`);
        }
      } else {
        console.log('LOH data from reports_function empty or unavailable; attendance muster will show LOH only from reports_function (no LOHreport table fallback).');
      }
    } catch (lohError) {
      console.error('Error fetching LOH from reports_function:', lohError);
    }

    // Generate LOH array from reports_function data only (no local calculation)
    const loh = employees.map(empId => {
      // Normalize employee ID to string for consistent matching
      const empIdStr = String(empId).trim();
      return dates.map(date => {
        const key = `${empIdStr}_${date}`;
       
        // Helper function to determine if date is WO or H (same logic as muster)
        const getMusterStatusForDate = () => {
          const rec = byKey[key];
         
          // Check if this date is a holiday (check before Sunday/Saturday checks)
          if (isHoliday(date)) {
            // If there's a CompOffWorkedOn record for this date, show 'P' instead of 'H'
            if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
              return 'Present'; // WorkedOn date should show as Present even on holiday
            }
            return 'H'; // Holiday (only if not a WorkedOn date)
          }
         
          // Check if this date is Sunday
          if (isSunday(date)) {
            // 3/1/2026 (03/01/2026): do not show WO; use P or A (support both 2026-01-03 and 2026-03-01)
            if (date === '2026-03-01' || date === '2026-01-03') {
              if (!rec) return 'Absent';
              return getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
            }
          // If there's a CompOffWorkedOn record for this date, show 'P' instead of 'WO'
            if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
              return 'Present'; // WorkedOn date should show as Present even on Sunday
            }
          return 'WO'; // Week Off (only if not a WorkedOn date)
          }
          if (!rec) return 'Absent';
          return getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
        };
       
        // Check if attendance muster status is WO or H - if so, skip LOH calculation
        const rec = byKey[key];
        const musterStatus = getMusterStatusForDate();
        if (rec && (musterStatus === 'WO' || musterStatus === 'H')) {
          // If attendance muster shows WO or H, do not calculate or use LOH
          return '';
        }
       
        // Skip excluded dates from LOH calculation
        if (isDateExcludedFromLOH(date)) {
          return ''; // Skip LOH calculation for this date
        }
       
        // Do not calculate or display LOH for Housekeeping shift
        if (isHousekeepingShift(empIdStr, date)) {
          return '';
        }
       
        // First, check if LOH data exists from reports_function (primary source)
        // This ensures we use the exact same data as LOH report
        let lohHours = null;
        let lohCalculatedByFunction = false;
        let totalWorkingMinutes = 0;
       
        // Check lohReportMap first - this is the PRIMARY source (from reports_function)
        if (lohReportMap[key] !== undefined) {
          // Use LOH from reports_function (same as LOH report uses)
          lohHours = lohReportMap[key];
          // Mark as calculated by function (from reports_function)
          lohCalculatedByFunction = true;
         
          // Debug logging for employee 32001
          if (empIdStr === '32001') {
            console.log(`Using LOH from reports_function for 32001: date=${date}, key=${key}, lohHours=${lohHours}`);
          }
         
          // Calculate totalWorkingMinutes for shouldIncludeRecord check (same as reports_function)
          if (rec && rec.FirstIN && rec.LastOUT) {
            try {
              const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
              const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
              if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
                const diffMs = lastOutDate - firstInDate;
                if (diffMs > 0) {
                  totalWorkingMinutes = Math.floor(diffMs / (1000 * 60));
                }
              }
            } catch (e) {
              // Ignore errors
            }
          }
        } else {
          // LOH must come from reports_function only; no local calculation fallback
          return '';
        }
       
        // Use LOH from reports_function only (same as LOH report)
        return parseFloat((lohHours || 0).toFixed(2));
      });
    });

    // Helper function to parse time from string
    const parseTimeFromString = (timeStr) => {
      if (!timeStr) return '';
     
      let timePart = '';
      if (typeof timeStr === 'string') {
        if (timeStr.includes(' ')) {
          const parts = timeStr.split(' ');
          timePart = parts[1] || '00:00:00';
        } else {
          timePart = timeStr;
        }
      } else {
        const d = new Date(timeStr);
        if (!isNaN(d.getTime())) {
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          timePart = `${hours}:${minutes}:${seconds}`;
        } else {
          return '';
        }
      }
     
      if (timePart.split(':').length === 2) {
        timePart += ':00';
      }
     
      return timePart;
    };

    // When LastOUT includes YYYY-MM-DD (e.g. regularization night spill), use that instant; else use muster date + time.
    const lastOutInstantFromStr = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return null;
      const s = String(lastOutTimeStr).trim();
      const timePart = parseTimeFromString(lastOutTimeStr);
      if (!timePart) return null;
      if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) {
        const iso = s.length >= 19 ? s.substring(0, 19).replace(' ', 'T') : s.replace(' ', 'T');
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(`${dateStr} ${timePart}`.replace(' ', 'T'));
      return isNaN(d.getTime()) ? null : d;
    };

    // Helper function to calculate overtime based on shift end time
    const calculateOvertimeForShift = (lastOutTimeStr, dateStr, expectedCheckoutTime) => {
      if (!lastOutTimeStr || !dateStr || !expectedCheckoutTime) return 0;
     
      try {
        const timePart = parseTimeFromString(lastOutTimeStr);
        if (!timePart) return 0;
       
        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        const expectedCheckout = new Date(`${dateStr} ${expectedCheckoutTime}`.replace(' ', 'T'));
       
        if (isNaN(lastOutTime.getTime()) || isNaN(expectedCheckout.getTime())) {
          return 0;
        }
       
        if (lastOutTime > expectedCheckout) {
          const diffMs = lastOutTime - expectedCheckout;
          const overtimeHours = diffMs / (1000 * 60 * 60);
          // Round to 3 decimal places to match monthly report precision
          return Math.max(0, parseFloat(overtimeHours.toFixed(3)));
        }
       
        return 0;
      } catch (error) {
        console.error('Error calculating overtime:', error, 'lastOutTimeStr:', lastOutTimeStr, 'dateStr:', dateStr, 'expectedCheckoutTime:', expectedCheckoutTime);
        return 0;
      }
    };

    // Helper functions for shift-specific overtime calculation
    // IMPORTANT: Keep these cutoffs aligned with `reports_function` (/monthly-overtime)
    const calculateOvertimeForGeneralShift = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return 0;
      try {
        const timePart = parseTimeFromString(lastOutTimeStr);
        if (!timePart) return 0;

        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        // Monthly OT report rule: no OT if checkout is 17:55 or earlier
        const cutoffTime = new Date(`${dateStr} 17:55:00`.replace(' ', 'T'));
        const baseTime = new Date(`${dateStr} 16:55:00`.replace(' ', 'T'));

        if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
          return 0;
        }

        // Only calculate OT if checkout is after cutoff (17:55)
        if (lastOutTime > cutoffTime) {
          const diffMs = lastOutTime - baseTime;
          const overtimeHours = diffMs / (1000 * 60 * 60);
          const result = Math.max(0, parseFloat(overtimeHours.toFixed(3)));
          return result;
        }

        return 0;
      } catch (error) {
        console.error('Error calculating General shift overtime:', error);
        return 0;
      }
    };

    const calculateOvertimeForFirstShift = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return 0;
      try {
        const timePart = parseTimeFromString(lastOutTimeStr);
        if (!timePart) return 0;

        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        // Monthly OT report rule: no OT if checkout is 15:00 or earlier
        const cutoffTime = new Date(`${dateStr} 15:00:00`.replace(' ', 'T'));
        const baseTime = new Date(`${dateStr} 14:00:00`.replace(' ', 'T'));

        if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
          return 0;
        }

        // Only calculate OT if checkout is after cutoff (15:00)
        if (lastOutTime > cutoffTime) {
          const diffMs = lastOutTime - baseTime;
          const overtimeHours = diffMs / (1000 * 60 * 60);
          const result = Math.max(0, parseFloat(overtimeHours.toFixed(3)));
          return result;
        }

        return 0;
      } catch (error) {
        console.error('Error calculating 1st shift overtime:', error);
        return 0;
      }
    };

    const calculateOvertimeForSecondShift = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return 0;
      try {
        const timePart = parseTimeFromString(lastOutTimeStr);
        if (!timePart) return 0;

        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        // Monthly OT report rule: no OT if checkout is 23:00 or earlier
        const cutoffTime = new Date(`${dateStr} 23:00:00`.replace(' ', 'T'));
        const baseTime = new Date(`${dateStr} 22:00:00`.replace(' ', 'T'));

        if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
          return 0;
        }

        // Only calculate OT if checkout is after cutoff (23:00)
        if (lastOutTime > cutoffTime) {
          const diffMs = lastOutTime - baseTime;
          const overtimeHours = diffMs / (1000 * 60 * 60);
          const result = Math.max(0, parseFloat(overtimeHours.toFixed(3)));
          return result;
        }

        return 0;
      } catch (error) {
        console.error('Error calculating 2nd shift overtime:', error);
        return 0;
      }
    };

    // General II shift: 12:00-20:00, 10 min grace, OT if checkout after 21:00
    const calculateOvertimeForGeneralIIShift = (lastOutTimeStr, dateStr) => {
      if (!lastOutTimeStr || !dateStr) return 0;
      try {
        const timePart = parseTimeFromString(lastOutTimeStr);
        if (!timePart) return 0;

        const lastOutTime = lastOutInstantFromStr(lastOutTimeStr, dateStr);
        if (!lastOutTime) return 0;
        // OT = checkout minus 20:00 (shift end) only if checkout is after 21:00
        const cutoffTime = new Date(`${dateStr} 21:00:00`.replace(' ', 'T'));
        const baseTime = new Date(`${dateStr} 20:00:00`.replace(' ', 'T'));

        if (isNaN(lastOutTime.getTime()) || isNaN(cutoffTime.getTime()) || isNaN(baseTime.getTime())) {
          return 0;
        }

        if (lastOutTime > cutoffTime) {
          const diffMs = lastOutTime - baseTime;
          const overtimeHours = diffMs / (1000 * 60 * 60);
          return Math.max(0, parseFloat(overtimeHours.toFixed(3)));
        }
        return 0;
      } catch (error) {
        console.error('Error calculating General II shift overtime:', error);
        return 0;
      }
    };

    // Generate overtimeHours array - calculate OT based on shift end times
    const overtimeHours = employees.map(empId =>
      dates.map(date => {
        const key = `${empId}_${date}`;
        const rec = byKey[key];
        if (!rec || !rec.FirstIN || !rec.LastOUT) return '';
        if (OT_EXCLUSIONS.has(key)) return '';
        // Comboff=Yes: never add OT for the taken date (CO day). Do not use includes('CompOff') — it matches CompOffWorkedOn.
        if (sourceHasCompOffTakenSegment(rec.Source)) return '';

        try {
          // OT=Yes in CompOff: whole working hours for that date count as OT (attendance muster unchanged)
          if (otYesFullHoursKeys.has(key)) {
            const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
            const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
            if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
              const diffMs = lastOutDate - firstInDate;
              if (diffMs > 0) {
                const otHours = diffMs / (1000 * 60 * 60);
                return parseFloat(otHours.toFixed(3));
              }
            }
            return '';
          }
          // WO/H rule: if employee worked on WO/H day, OT = total worked hours (LastOUT - FirstIN)
          const getMusterStatusForDate = () => {
            // Check if this date is a holiday (check before Sunday/Saturday checks)
            if (isHoliday(date)) {
              // If there's a CompOffWorkedOn record for this date, show 'P' instead of 'H'
              if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
                return 'Present';
              }
              return 'H';
            }

            // Check if this date is Sunday (WO)
            if (isSunday(date)) {
              // 3/1/2026 (03/01/2026): do not show WO; use P or A (support both 2026-01-03 and 2026-03-01)
              if (date === '2026-03-01' || date === '2026-01-03') {
                return getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
              }
              if (rec && (rec.Source === 'CompOffWorkedOn' || rec.Source?.includes('CompOffWorkedOn'))) {
                return 'Present';
              }
              return 'WO';
            }

            return getStatus(rec.FirstIN, rec.LastOUT, rec.ProvidedStatus, rec.Source);
          };

          const musterStatus = getMusterStatusForDate();

          // Check which shift the employee is on for this date (NewShiftMap has priority)
          const isHousekeeping = isHousekeepingShift(empId, date);
          const isGeneralII = isGeneralIIShift(empId, date);
          const isGeneral = isGeneralShift(empId, date);
          const isFirst = isFirstShift(empId, date);
          const isSecond = isSecondShift(empId, date);
         
          let otHours = 0;
         
          if (musterStatus === 'WO' || musterStatus === 'H') {
            const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
            const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
            if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
              const diffMs = lastOutDate - firstInDate;
              if (diffMs > 0) {
                otHours = diffMs / (1000 * 60 * 60);
              }
            }
          } else if (isHousekeeping) {
            // Housekeeping: OT only when total > 9h; then OT = total − 8 (e.g. 9h 30m → 1h 30m OT; 8h 30m → 0 OT)
            const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
            const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
            if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
              const diffMs = lastOutDate - firstInDate;
              if (diffMs > 0) {
                const totalWorkingHours = diffMs / (1000 * 60 * 60);
                otHours = totalWorkingHours > 9 ? (totalWorkingHours - 8) : 0;
              }
            }
          } else if (isGeneralII) {
            // For General II shift: 12:00-20:00, OT if checkout after 21:00
            otHours = calculateOvertimeForGeneralIIShift(rec.LastOUT, date);
          } else if (isGeneral) {
            // For General shift: Calculate OT if checkout is after 17:55 (per Monthly OT report)
            otHours = calculateOvertimeForGeneralShift(rec.LastOUT, date);
          } else if (isFirst) {
            // For 1st shift: Calculate OT if checkout is after 15:00 (per Monthly OT report)
            otHours = calculateOvertimeForFirstShift(rec.LastOUT, date);
          } else if (isSecond) {
            // For 2nd shift: Calculate OT if checkout is after 23:00 (per Monthly OT report)
            otHours = calculateOvertimeForSecondShift(rec.LastOUT, date);
          } else {
            // For other shifts: Calculate OT if total hours > 8.5
            const firstInDate = new Date(rec.FirstIN.replace(' ', 'T'));
            const lastOutDate = new Date(rec.LastOUT.replace(' ', 'T'));
           
            if (!isNaN(firstInDate) && !isNaN(lastOutDate)) {
              const diffMs = lastOutDate - firstInDate;
              if (diffMs > 0) {
                const totalWorkingHours = diffMs / (1000 * 60 * 60);
                if (totalWorkingHours > 8.5) {
                  otHours = totalWorkingHours - 8.5;
                }
              }
            }
          }
         
          if (otHours > 0) {
            return parseFloat(otHours.toFixed(3));
          }
          return '';
        } catch (error) {
          console.error(`Error calculating OT hours for ${empId} on ${date}:`, error);
          return '';
        }
      })
    );

    console.log(`Generated muster report: ${employees.length} employees x ${dates.length} days`);
    console.log(`Data sources: BHR records=${allLogs.length}, Attendance records=${attendanceInRange}, OnDuty records=${ondutyInRange}, CompOff records=${compoffInRange}, BioMax records=${biomaxInRange}`);

    // Pre-compute monthly OT totals per employee (sum of daily OT values). Values are rounded to 3 decimals to match Monthly OT report precision.
    const monthlyOvertime = overtimeHours.map(row => {
      const sum = row.reduce((s, v) => {
        if (v === '' || v === null || v === undefined) return s;
        const n = parseFloat(v);
        if (isNaN(n)) return s;
        return s + n;
      }, 0);
      return parseFloat(sum.toFixed(3));
    });

    // OT Hours must come from reports_function (/monthly-overtime) only.
    let monthlyOvertimeReports = employees.map(() => 0);

    // Fetch monthly OT totals from reports_function only (monthly OT applicable employees)
    // Sets OT Hours from Monthly OT report (applicable employees only); no local fallback.
    try {
      const params = new URLSearchParams();
      params.set('startDate', startDate);
      params.set('endDate', endDate);
      if (contractor && contractor !== 'All') params.set('contractor', contractor);
      if (department && department !== 'All') params.set('department', department);
      if (userEmail) params.set('userEmail', userEmail);
      if (userRole) params.set('userRole', userRole);

      // Build base URL from current request host (works across environments)
      const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = forwardedProto || (req.connection && req.connection.encrypted ? 'https' : 'https');
      const host = req.headers.host;
      const baseUrl = host ? `${proto}://${host}` : (process.env.CATALYST_FUNCTION_URL ? process.env.CATALYST_FUNCTION_URL.replace(/\/$/, '') : '');

      if (baseUrl) {
        const reportsUrl = `${baseUrl}/server/reports_function/monthly-overtime?${params.toString()}`;
        console.log(`Fetching Monthly OT totals from reports_function for muster OT Hours: ${reportsUrl}`);

        const httpClient = reportsUrl.startsWith('https://') ? https : http;
        const parsed = new URL(reportsUrl);

        const totalsMap = await new Promise((resolve) => {
          const reqHttp = httpClient.request(
            {
              hostname: parsed.hostname,
              port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Catalyst-AttendanceMuster/1.0'
              },
              timeout: 30000
            },
            (resHttp) => {
              let body = '';
              resHttp.on('data', (chunk) => (body += chunk));
              resHttp.on('end', () => {
                try {
                  if (resHttp.statusCode !== 200) {
                    console.error(`reports_function/monthly-overtime returned ${resHttp.statusCode}. Body (first 500): ${String(body).slice(0, 500)}`);
                    return resolve(null);
                  }
                  const json = JSON.parse(body || '{}');
                  const rows = Array.isArray(json.data) ? json.data : [];
                  const map = {};
                  rows.forEach((r) => {
                    const empId = String(r.employeeId || '').trim();
                    if (!empId) return;
                    const v = parseFloat(r.totalOvertimeHours);
                    map[empId] = isNaN(v) ? 0 : v;
                  });
                  return resolve(map);
                } catch (e) {
                  console.error('Error parsing reports_function/monthly-overtime response:', e.message);
                  return resolve(null);
                }
              });
            }
          );

          reqHttp.on('error', (e) => {
            console.error('Error calling reports_function/monthly-overtime:', e.message);
            resolve(null);
          });
          reqHttp.on('timeout', () => {
            reqHttp.destroy();
            console.error('Timeout calling reports_function/monthly-overtime after 30s');
            resolve(null);
          });
          reqHttp.end();
        });

        if (totalsMap && Object.keys(totalsMap).length > 0) {
          const newMonthly = employees.map((emp) => {
            const key = String(emp || '').trim();
            const val = totalsMap[key] || 0;
            // Keep 3-decimal precision to match existing muster payload expectations
            return parseFloat((val || 0).toFixed(3));
          });
          monthlyOvertimeReports = newMonthly;
          console.log(`✅ Using reports_function Monthly OT totals for muster: ${monthlyOvertimeReports.length} employees. Sample:`, monthlyOvertimeReports.slice(0, 5));
        } else {
          console.log('⚠️ reports_function returned no Monthly OT totals; using 0.00 OT Hours in muster.');
        }
      } else {
        console.log('⚠️ Could not determine baseUrl to call reports_function; using 0.00 OT Hours in muster.');
      }
    } catch (e) {
      console.error('Error fetching monthlyOvertimeReports from reports_function:', e.message);
      // Keep reports-only behavior; monthlyOvertimeReports stays 0.
    }

    // Build preferred monthly OT: reports_function values only.
    const monthlyOvertimePreferred = employees.map((emp, idx) => {
      const reportsVal = (monthlyOvertimeReports && monthlyOvertimeReports[idx] !== undefined && monthlyOvertimeReports[idx] !== null) ? monthlyOvertimeReports[idx] : 0;
      return parseFloat((reportsVal || 0).toFixed(3));
    });

    // Calculate total LOH using the same logic as LOH report
    // LOH report calculates from source data (BHR/Attendance/BioMax), so we sum the calculated daily LOH values
    // This ensures attendance muster displays the same total LOH hours as shown in LOH report
    // IMPORTANT: LOH report includes 0.00 values in the total, so we must include them too
    const monthlyLOHPreferred = employees.map((empId, idx) => {
      // Sum all daily LOH values from calculated data (same as LOH report does)
      // The loh array contains daily LOH values calculated from source data using the same logic as LOH report
      // Include 0.00 values in the sum (same as LOH report does)
      let totalLOH = 0;
      if (loh && loh[idx] && Array.isArray(loh[idx])) {
        totalLOH = loh[idx].reduce((sum, lohValue) => {
          // Include 0.00 values (parseFloat('0.00') = 0, which is valid)
          // Only skip empty strings and NaN values
          if (lohValue !== '' && lohValue !== null && lohValue !== undefined && !isNaN(lohValue)) {
            return sum + parseFloat(lohValue);
          }
          return sum;
        }, 0);
      }
     
      const result = parseFloat((totalLOH || 0).toFixed(2));
      // Debug logging for first few employees
      if (idx < 3) {
        console.log(`Employee ${empId}: monthlyLOHPreferred = ${result}, daily LOH values (including 0.00):`, loh && loh[idx] ? loh[idx].slice(0, 5) : 'N/A');
      }
      return result;
    });
   
    console.log(`Calculated monthlyLOHPreferred for ${monthlyLOHPreferred.length} employees. Sample values:`, monthlyLOHPreferred.slice(0, 5));

    // Optionally compute comparison if requested
    const compareMonthlyOt = (url.searchParams.get('compareMonthlyOt') || 'false').toLowerCase() === 'true';
    let monthlyOtComparison = null;
    if (compareMonthlyOt) {
      try {
        monthlyOtComparison = employees.map((emp, idx) => {
          const muster = monthlyOvertime[idx] || 0;
          const reportsVal = monthlyOvertimeReports[idx] || 0;
          return {
            employee: emp,
            musterMonthlyOt: muster,
            reportsMonthlyOt: reportsVal,
            diff: parseFloat((muster - reportsVal).toFixed(3))
          };
        });
        console.log('Monthly OT comparison computed for', monthlyOtComparison.filter(c => c.diff !== 0).length, 'employees with differences');
      } catch (cmpErr) {
        console.error('Error computing monthly OT comparison:', cmpErr);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      dates,
      employees,
      muster,
      firstIn,
      lastOut,
      totalHours,
      loh,
      overtimeHours,
      shiftTypes,
      monthlyOvertime,
      monthlyOvertimeReports,
      monthlyOvertimePreferred,
      monthlyOtComparison,
      monthlyLOHPreferred,
      employeeNames,
      contractors,
      departments,
      dateOfJoining,
      dateOfExit,
      sources,
      ondutyFirstIn,
      ondutyLastOut,
      ondutyAppliedFirstIn,
      ondutyAppliedLastOut,
      realFirstIn,
      realLastOut,
      lohFirstIn,
      lohLastOut,
      summary: {
        totalEmployees: employees.length,
        totalDays: dates.length,
        bhrRecords: allLogs.length,
        attendanceRecords: attendanceInRange,
        ondutyRecords: ondutyInRange,
        compoffRecords: compoffInRange,
        biomaxRecords: biomaxInRange,
        dateRange: `${startDate} to ${endDate}`,
        source: source
      }
    }));
  } catch (err) {
    console.error('Attendance Muster Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};
