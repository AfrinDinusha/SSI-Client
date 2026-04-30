const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
const fileUpload = require('express-fileupload');
const fs = require('fs');
const os = require('os');
const path = require('path');
app.use(express.json());
app.use(fileUpload());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Debug endpoint to test employee data
app.get('/employees/debug', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        
        // Simple query to get all employees without filtering
        const debugQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ORDER BY ROWID DESC LIMIT 10`;
        console.log(`Debug query: ${debugQuery}`);
        
        const debugResult = await zcql.executeZCQLQuery(debugQuery);
        console.log(`Debug result count: ${debugResult.length}`);
        
        res.status(200).send({
            status: 'success',
            data: {
                employees: debugResult,
                count: debugResult.length
            }
        });
    } catch (err) {
        console.error('Debug endpoint error:', err);
        res.status(500).send({
            status: 'failure',
            message: "Debug endpoint failed: " + err.message
        });
    }
});

// GET API: Get all employees (with optional pagination)
app.get('/employees', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50; // Changed default to 50 to match frontend
        const userEmail = req.query.userEmail; // Get user email from query params
        const userRole = req.query.userRole; // Get user role from query params
       
        console.log('Employee fetch request:', { userEmail, userRole, page, perPage });
        console.log('=== DEBUG: Starting employee fetch for user:', userEmail, 'with role:', userRole);
        console.log('=== DEBUG: User role type:', typeof userRole, 'User email type:', typeof userEmail);
        const zcql = catalyst.zcql();

        // Build WHERE clause for contractor filtering
        let whereClause = '';
        let countWhereClause = '';
       
        // If user is App User (contractor), filter by contractor email
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;
           
            // Check hardcoded mappings
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                // Try to find the actual contractor name in the database (could be "Samuel Enterprise" or "Samuel Enterprises")
                try {
                    const samuelQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Samuel%' LIMIT 10`
                    );
                    if (samuelQuery && samuelQuery.length > 0) {
                        // Log all found variations for debugging
                        const foundNames = samuelQuery.map(row => row.Employee?.ContractorName).filter(Boolean);
                        console.log(`[afrinatlin@gmail.com] Found ${foundNames.length} Samuel contractor name variations: ${foundNames.join(', ')}`);
                        
                        // Use the first matching contractor name found in the database
                        contractorName = samuelQuery[0].Employee?.ContractorName;
                        console.log(`[afrinatlin@gmail.com] Using contractor name: ${contractorName}`);
                        
                        // Also log how many employees match this exact name
                        const countQuery = await zcql.executeZCQLQuery(
                            `SELECT COUNT(ROWID) as count FROM Employee WHERE ContractorName = '${contractorName.replace(/'/g, "''")}'`
                        );
                        const exactCount = countQuery[0]?.Employee?.count || 0;
                        console.log(`[afrinatlin@gmail.com] Employees with exact name "${contractorName}": ${exactCount}`);
                        
                        // Also check how many match the flexible pattern
                        const flexibleCountQuery = await zcql.executeZCQLQuery(
                            `SELECT COUNT(ROWID) as count FROM Employee WHERE ContractorName LIKE '%Samuel%'`
                        );
                        const flexibleCount = flexibleCountQuery[0]?.Employee?.count || 0;
                        console.log(`[afrinatlin@gmail.com] Employees matching '%Samuel%' pattern: ${flexibleCount}`);
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
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                    }
                } catch (error) {
                    console.error('Error filtering by contractor:', error);
                }
            }
           
            // Filter employees by contractor name (case-insensitive with flexible matching)
            if (contractorName) {
                // Normalize contractor name: trim whitespace to ensure proper matching
                const normalizedContractorName = String(contractorName).trim();
                // Escape single quotes in contractor name to prevent SQL injection
                const escapedContractorName = normalizedContractorName.replace(/'/g, "''");
                
                console.log(`Filtering employees - Original contractor name: "${contractorName}", Normalized: "${normalizedContractorName}"`);
                
                // For Samuel Enterprise/Enterprises, use very flexible matching
                if (normalizedContractorName.toLowerCase().includes('samuel')) {
                    // Use LIKE pattern that matches any contractor name containing "Samuel"
                    // This will match "Samuel Enterprise", "Samuel Enterprises", "Samuel Enterprise Company", etc.
                    whereClause = `WHERE ContractorName LIKE '%Samuel%'`;
                    countWhereClause = `WHERE ContractorName LIKE '%Samuel%'`;
                    console.log(`Filtering employees for contractor (flexible matching for Samuel - any name containing 'Samuel'): ${normalizedContractorName}`);
                } else {
                    // For other contractors, use exact match (case-insensitive)
                    // Note: ContractorName is now normalized (trimmed) when creating employees,
                    // so this should match correctly. Using LOWER() for case-insensitive comparison.
                    whereClause = `WHERE LOWER(ContractorName) = LOWER('${escapedContractorName}')`;
                    countWhereClause = `WHERE LOWER(ContractorName) = LOWER('${escapedContractorName}')`;
                    console.log(`Filtering employees for contractor (case-insensitive): ${normalizedContractorName}`);
                }
            } else {
                // If no contractor found, show all employees for App Users
                console.log(`No contractor found for user ${userEmail}, showing all employees`);
                whereClause = '';
                countWhereClause = '';
            }
        }

        // Get total count for pagination with contractor filter
        const countQuery = `SELECT COUNT(ROWID) as count FROM Employee ${countWhereClause}`;
        console.log(`Executing count query: ${countQuery}`);
        
        let countRows;
        let total = 0;
        try {
            countRows = await zcql.executeZCQLQuery(countQuery);
            console.log(`Count query result:`, countRows);
            total = parseInt(countRows[0].Employee['COUNT(ROWID)']) || 0;
            console.log(`Total employees found: ${total}`);
            
            // If filtered query returns 0 results, try showing all employees
            if (total === 0 && whereClause) {
                console.log('Filtered query returned 0 results, trying fallback to show all employees');
                try {
                    const fallbackCountQuery = `SELECT COUNT(ROWID) as count FROM Employee`;
                    const fallbackCountRows = await zcql.executeZCQLQuery(fallbackCountQuery);
                    const fallbackTotal = parseInt(fallbackCountRows[0].Employee['COUNT(ROWID)']) || 0;
                    if (fallbackTotal > 0) {
                        console.log(`Fallback count query successful, total: ${fallbackTotal}`);
                        total = fallbackTotal;
                        whereClause = '';
                        countWhereClause = '';
                    }
                } catch (fallbackError) {
                    console.error('Fallback count query failed:', fallbackError);
                }
            }
        } catch (countError) {
            console.error('Count query error:', countError);
            console.error('Count query that failed:', countQuery);
            // Fallback to count all employees if contractor filter fails
            try {
                const fallbackCountQuery = `SELECT COUNT(ROWID) as count FROM Employee`;
                const fallbackCountRows = await zcql.executeZCQLQuery(fallbackCountQuery);
                total = parseInt(fallbackCountRows[0].Employee['COUNT(ROWID)']) || 0;
                console.log(`Fallback count query successful, total: ${total}`);
                whereClause = '';
                countWhereClause = '';
            } catch (fallbackError) {
                console.error('Fallback count query also failed:', fallbackError);
                total = 0;
            }
        }

        // Check if we should return all records (no pagination)
        const returnAll = !req.query.page && !req.query.perPage;
       
        // Build LIMIT clause
        const limitClause = returnAll ? '' : `LIMIT ${(page - 1) * perPage + 1},${perPage}`;

        // First query: Fetch up to 30 columns (move PresentCountry to secondQueryColumns)
        const firstQueryColumns = [
            'ROWID', 'EmployeeCode', 'EmployeeName', 'Personalemailaddress', 'Phone', 'DateofJoining',
            'DateofExit',
            'OverallExperience', 'RelevantExperience', 'SourceofHire', 'PFNo', 'ESICNo', 'Location',
            'GradeLevel', 'UANNo', 'DateofBirth', 'FathersName', 'Age', 'EmergencyContactNumber',
            'Gender', 'BloodGroup', 'MaritalStatus', 'PresentAddressLine1', 'PresentAddressLine2',
            'PresentCity', 'PresentState', 'PresentPostalCode', /*'PresentCountry',*/ 'PermanentAddressLine1',
            'CREATEDTIME', 'MODIFIEDTIME'
        ];
        // Add PresentCountry and emergency contact fields to secondQueryColumns (moved from first query to stay under 30 column limit)
        const secondQueryColumns = [
            'ROWID', 'PermanentAddressLine2', 'PermanentCity', 'PermanentState', 'PermanentPostalCode', 'PermanentCountry',
            'PresentCountry', // <-- Added here
            'PFStatus', 'ESIStatus', // <-- Added here
            'ActualBasic', 'ActualHRA', 'ActualSpecialAllowance', 'TotalSalary', 'aadhaarNumber', 'panNumber', 'employeeStatus', 'Added_User', 'Modified_User', 'Department', 'Designation', 'ContractorName', 'EmploymentType', 'Category',
            'EmergencyContactName', 'EmergencyContactAddress', 'EmergencyCity', 'EmergencyState', 'EmergencyPostalCode', 'Spouse'
        ];
        // Third query: Education details (moved to separate query to stay under 30 column limit)
        const educationQueryColumns = [
            'ROWID', 'Qualification', 'InstitutionName', 'FieldOfStudy', 'YearOfCompletion', 'PercentageMarks'
        ];
        const firstQueryString = `SELECT ${firstQueryColumns.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
        console.log(`Executing first query: ${firstQueryString}`);
        
        let firstQuery, secondQuery;
        try {
            firstQuery = await zcql.executeZCQLQuery(firstQueryString);
            console.log(`First query result count: ${firstQuery.length}`);
            // Debug: Log first row to see what columns are actually returned
            if (firstQuery.length > 0) {
                console.log('First query sample row keys:', Object.keys(firstQuery[0].Employee || {}));
                console.log('Note: Emergency contact fields (EmergencyContactName, EmergencyContactAddress, etc.) are now in the second query to stay under 30 column limit.');
            }
        } catch (firstError) {
            console.error('First query error:', firstError);
            console.error('First query that failed:', firstQueryString);
            console.error('Error message:', firstError.message);
            console.error('Error details:', JSON.stringify(firstError));
            
            // Check if error is due to too many columns (30 column limit)
            const errorMessage = firstError.message || firstError.toString() || '';
            const isColumnLimitError = errorMessage.toLowerCase().includes('more than 30') || 
                                      errorMessage.toLowerCase().includes('30 select columns');
            
            // Check if error is due to missing PFStatus or ESIStatus columns
            const isMissingStatusColumns = errorMessage.includes('PFStatus') || errorMessage.includes('ESIStatus');
            
            if (isColumnLimitError) {
                console.error('First query exceeds 30 column limit. Current count:', firstQueryColumns.length);
                console.error('This should not happen - emergency contact fields have been moved to second query.');
                firstQuery = [];
            } else if (isMissingStatusColumns) {
                // Retry query without PFStatus and ESIStatus columns (they may not exist yet)
                console.log('PFStatus or ESIStatus columns do not exist, retrying without them');
                try {
                    const columnsWithoutStatus = firstQueryColumns.filter(col => 
                        !['PFStatus', 'ESIStatus'].includes(col)
                    );
                    const fallbackFirstQuery = `SELECT ${columnsWithoutStatus.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
                    firstQuery = await zcql.executeZCQLQuery(fallbackFirstQuery);
                    console.log(`Fallback first query (without status columns) successful, count: ${firstQuery.length}`);
                } catch (fallbackError) {
                    console.error('Fallback first query (without status columns) also failed:', fallbackError);
                    // Try without WHERE clause as well
                    try {
                        const columnsWithoutStatus = firstQueryColumns.filter(col => 
                            !['PFStatus', 'ESIStatus'].includes(col)
                        );
                        const fallbackFirstQuery = `SELECT ${columnsWithoutStatus.join(', ')} FROM Employee ORDER BY ROWID DESC ${limitClause}`;
                        firstQuery = await zcql.executeZCQLQuery(fallbackFirstQuery);
                        console.log(`Fallback first query (without status columns and WHERE) successful, count: ${firstQuery.length}`);
                    } catch (finalError) {
                        console.error('Final fallback first query also failed:', finalError);
                        firstQuery = [];
                    }
                }
            } else {
                // Fallback to query without WHERE clause (might be a WHERE clause issue, not column issue)
                try {
                    const fallbackFirstQuery = `SELECT ${firstQueryColumns.join(', ')} FROM Employee ORDER BY ROWID DESC ${limitClause}`;
                    firstQuery = await zcql.executeZCQLQuery(fallbackFirstQuery);
                    console.log(`Fallback first query successful, count: ${firstQuery.length}`);
                } catch (fallbackError) {
                    console.error('Fallback first query also failed:', fallbackError);
                    firstQuery = [];
                }
            }
        }

        // Second query: Fetch remaining columns (now 7 columns)
        const secondQueryString = `SELECT ${secondQueryColumns.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
        console.log(`Executing second query: ${secondQueryString}`);
        try {
            secondQuery = await zcql.executeZCQLQuery(secondQueryString);
            console.log(`Second query result count: ${secondQuery.length}`);
        } catch (secondError) {
            console.error('Second query error:', secondError);
            console.error('Second query that failed:', secondQueryString);
            console.error('Second query also failed after fallback:', secondError);
            secondQuery = [];
        }
        
        // Bank details query split from second query to stay under 30-column limit
        const bankColumns = ['ROWID', 'BankHolderName', 'BankName', 'AccountNumber', 'IFSCCode', 'BankBranch'];
        let bankQuery;
        try {
            const bankQueryString = `SELECT ${bankColumns.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
            console.log(`Executing bank query: ${bankQueryString}`);
            bankQuery = await zcql.executeZCQLQuery(bankQueryString);
            console.log(`Bank query result count: ${bankQuery.length}`);
        } catch (bankError) {
            console.error('Bank query error:', bankError);
            // Fallback to query without WHERE clause to avoid empty results if filter fails
            try {
                const fallbackBankQueryString = `SELECT ${bankColumns.join(', ')} FROM Employee ORDER BY ROWID DESC ${limitClause}`;
                bankQuery = await zcql.executeZCQLQuery(fallbackBankQueryString);
                console.log(`Fallback bank query successful, count: ${bankQuery.length}`);
            } catch (finalBankError) {
                console.error('Final bank query also failed:', finalBankError);
                bankQuery = [];
            }
        }

        // Third query: Fetch education details (6 columns) + JSON fallback column
        const educationQueryColumnsWithJSON = [
            'ROWID', 'Qualification', 'InstitutionName', 'FieldOfStudy', 'YearOfCompletion', 'PercentageMarks', 'EducationDetailsJSON'
        ];
        let educationQuery;
        try {
            const educationQueryString = `SELECT ${educationQueryColumnsWithJSON.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
            console.log(`Executing education query: ${educationQueryString}`);
            educationQuery = await zcql.executeZCQLQuery(educationQueryString);
            console.log(`Education query result count: ${educationQuery.length}`);
        } catch (educationError) {
            // If EducationDetailsJSON column doesn't exist, try without it
            if (educationError.message && educationError.message.includes('EducationDetailsJSON')) {
                console.log('EducationDetailsJSON column does not exist, using columns only');
                try {
                    const educationQueryString = `SELECT ${educationQueryColumns.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
                    educationQuery = await zcql.executeZCQLQuery(educationQueryString);
                    console.log(`Education query (without JSON column) result count: ${educationQuery.length}`);
                } catch (fallbackError) {
                    console.error('Education query (without JSON) also failed:', fallbackError);
                    educationQuery = [];
                }
            } else {
                console.error('Education query error:', educationError);
                // Fallback to query without WHERE clause
                try {
                    const fallbackEducationQuery = `SELECT ${educationQueryColumns.join(', ')} FROM Employee ORDER BY ROWID DESC ${limitClause}`;
                    educationQuery = await zcql.executeZCQLQuery(fallbackEducationQuery);
                    console.log(`Fallback education query successful, count: ${educationQuery.length}`);
                } catch (fallbackError) {
                    console.error('Fallback education query also failed:', fallbackError);
                    educationQuery = [];
                }
            }
        }
        
        // Fourth query: Fetch file name and file id columns (+ salary fields)
        const fileColumnsBase = [
            'ROWID',
            'PhotoFileId', 'PhotoFileName',
            'AadharCopyFileId', 'AadharCopyFileName',
            'PFEpassbookFileId', 'PFEpassbookFileName',
            'EducationalCertificatesFileId', 'EducationalCertificatesFileName',
            'BankPassbookFileId', 'BankPassbookFileName',
            'ExperienceCertificateFileId', 'ExperienceCertificateFileName',
            'PANCardFileId', 'PANCardFileName',
            'ResumeFileId', 'ResumeFileName',
            'ActualDA', 'AttendanceAllowance', 'OtherAllowance', 'TravelChargers'
        ];
        const fileColumns = [
            ...fileColumnsBase,
            'FoodAllowance',
            'UniformAllowance'
        ];
        let fourthQuery;
        try {
            const fourthQueryString = `SELECT ${fileColumns.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
            console.log(`Executing fourth query (files): ${fourthQueryString}`);
            fourthQuery = await zcql.executeZCQLQuery(fourthQueryString);
            console.log(`Fourth query result count: ${fourthQuery.length}`);
        } catch (fourthError) {
            console.error('Fourth query error:', fourthError);
            console.error('Fourth query that failed:', fourthQueryString);
            // If schema doesn't have the new columns yet, retry with the base columns.
            try {
                if (fourthError?.message && (fourthError.message.includes('FoodAllowance') || fourthError.message.includes('UniformAllowance'))) {
                    const retryQueryString = `SELECT ${fileColumnsBase.join(', ')} FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
                    console.log(`Retrying fourth query (files) without new columns: ${retryQueryString}`);
                    fourthQuery = await zcql.executeZCQLQuery(retryQueryString);
                    console.log(`Fourth query retry result count: ${fourthQuery.length}`);
                }
            } catch (retryErr) {
                console.error('Fourth query retry failed:', retryErr);
            }

            if (fourthQuery && Array.isArray(fourthQuery) && fourthQuery.length > 0) {
                // ok (retry succeeded)
            } else {
            // Fallback to query without WHERE clause
            try {
                const fallbackFourthQuery = `SELECT ${fileColumnsBase.join(', ')} FROM Employee ORDER BY ROWID DESC ${limitClause}`;
                fourthQuery = await zcql.executeZCQLQuery(fallbackFourthQuery);
                console.log(`Fallback fourth query successful, count: ${fourthQuery.length}`);
            } catch (fallbackError) {
                console.error('Fallback fourth query also failed:', fallbackError);
                fourthQuery = [];
            }
            }
        }

        // Combine results by matching ROWID (more robust matching)
        // Create maps for faster lookup
        const secondQueryMap = new Map();
        secondQuery.forEach(row => {
            if (row.Employee && row.Employee.ROWID) {
                secondQueryMap.set(row.Employee.ROWID, row);
            }
        });
        const educationQueryMap = new Map();
        educationQuery.forEach(row => {
            if (row.Employee && row.Employee.ROWID) {
                educationQueryMap.set(row.Employee.ROWID, row);
            }
        });
        const bankQueryMap = new Map();
        bankQuery.forEach(row => {
            if (row.Employee && row.Employee.ROWID) {
                bankQueryMap.set(row.Employee.ROWID, row);
            }
        });
        const fourthQueryMap = new Map();
        fourthQuery.forEach(row => {
            if (row.Employee && row.Employee.ROWID) {
                fourthQueryMap.set(row.Employee.ROWID, row);
            }
        });
        
        const employees = firstQuery.map((row, index) => {
            const rowId = row.Employee.ROWID;
            const secondRow = secondQueryMap.get(rowId) || {};
            const educationRow = educationQueryMap.get(rowId) || {};
            const bankRow = bankQueryMap.get(rowId) || {};
            const fourthRow = fourthQueryMap.get(rowId) || {};
            
            // Debug logging for first employee's emergency fields
            if (index === 0) {
                console.log(`=== DEBUG: Mapping first employee ${row.Employee.EmployeeCode} emergency fields ===`);
                console.log('Raw DB values:', {
                    EmergencyContactName: row.Employee?.EmergencyContactName,
                    EmergencyContactAddress: row.Employee?.EmergencyContactAddress,
                    EmergencyCity: row.Employee?.EmergencyCity,
                    EmergencyState: row.Employee?.EmergencyState,
                    EmergencyPostalCode: row.Employee?.EmergencyPostalCode,
                    Spouse: row.Employee?.Spouse,
                    typeOfEmergencyContactName: typeof row.Employee?.EmergencyContactName,
                    hasEmergencyContactName: 'EmergencyContactName' in (row.Employee || {}),
                    allKeys: Object.keys(row.Employee || {}).filter(k => k.includes('Emergency') || k === 'Spouse')
                });
            }
            
            return {
                id: row.Employee.ROWID,
                employeeCode: row.Employee.EmployeeCode,
                employeeName: row.Employee.EmployeeName,
                personalEmail: row.Employee.Personalemailaddress,
                phone: row.Employee.Phone,
                dateOfJoining: row.Employee.DateofJoining,
                dateOfExit: row.Employee.DateofExit || null, // <-- Added here
                overallExperience: row.Employee.OverallExperience,
                relevantExperience: row.Employee.RelevantExperience,
                sourceOfHire: row.Employee.SourceofHire,
                pfNo: row.Employee.PFNo,
                esicNo: row.Employee.ESICNo,
                pfStatus: secondRow.Employee?.PFStatus || null,
                esiStatus: secondRow.Employee?.ESIStatus || null,
                location: row.Employee.Location,
                gradeLevel: row.Employee.GradeLevel,
                uanNo: row.Employee.UANNo,
                contractor: secondRow.Employee?.ContractorName || null,
                employmentType: secondRow.Employee?.EmploymentType || null,
                department: secondRow.Employee?.Department || null,
                designation: secondRow.Employee?.Designation || null,
                category: secondRow.Employee?.Category || null,
                employeeStatus: secondRow.Employee?.employeeStatus || null,
                aadhaarNumber: secondRow.Employee?.aadhaarNumber || null,
                panNumber: secondRow.Employee?.panNumber || null,
                dateOfBirth: row.Employee.DateofBirth,
                fathersName: row.Employee.FathersName,
                age: row.Employee.Age,
                emergencyContactNumber: row.Employee?.EmergencyContactNumber || null,
                emergencyContactName: secondRow.Employee?.EmergencyContactName || null,
                emergencyContactAddress: secondRow.Employee?.EmergencyContactAddress || null,
                emergencyCity: secondRow.Employee?.EmergencyCity || null,
                emergencyState: secondRow.Employee?.EmergencyState || null,
                emergencyPostalCode: secondRow.Employee?.EmergencyPostalCode || null,
                spouse: secondRow.Employee?.Spouse || null,
                gender: row.Employee.Gender,
                bloodGroup: row.Employee.BloodGroup,
                maritalStatus: row.Employee.MaritalStatus,
                presentAddressLine1: row.Employee.PresentAddressLine1,
                presentAddressLine2: row.Employee.PresentAddressLine2,
                presentCity: row.Employee.PresentCity,
                presentState: row.Employee.PresentState,
                presentPostalCode: row.Employee.PresentPostalCode,
                presentCountry: secondRow.Employee?.PresentCountry || null,
                permanentAddressLine1: row.Employee.PermanentAddressLine1,
                permanentAddressLine2: secondRow.Employee?.PermanentAddressLine2 || null,
                permanentCity: secondRow.Employee?.PermanentCity || null,
                permanentState: secondRow.Employee?.PermanentState || null,
                permanentPostalCode: secondRow.Employee?.PermanentPostalCode || null,
                permanentCountry: secondRow.Employee?.PermanentCountry || null,
                actualBasic: secondRow.Employee?.ActualBasic || null,
                actualHRA: secondRow.Employee?.ActualHRA || null,
                actualSpecialAllowance: secondRow.Employee?.ActualSpecialAllowance ?? null,
                actualDA: secondRow.Employee?.ActualDA ?? fourthRow.Employee?.ActualDA ?? null,
                attendanceAllowance: secondRow.Employee?.AttendanceAllowance ?? fourthRow.Employee?.AttendanceAllowance ?? null,
                otherAllowance: secondRow.Employee?.OtherAllowance ?? fourthRow.Employee?.OtherAllowance ?? null,
                travelChargers:
                  fourthRow.Employee?.TravelChargers ??
                  fourthRow.Employee?.travelChargers ??
                  fourthRow.Employee?.TravelCharges ??
                  fourthRow.Employee?.travelCharges ??
                  null,
                foodAllowance: secondRow.Employee?.FoodAllowance ?? fourthRow.Employee?.FoodAllowance ?? null,
                uniformAllowance: secondRow.Employee?.UniformAllowance ?? fourthRow.Employee?.UniformAllowance ?? null,
                totalSalary: secondRow.Employee?.TotalSalary || null,
                bankHolderName: bankRow.Employee?.BankHolderName || secondRow.Employee?.BankHolderName || null,
                bankName: bankRow.Employee?.BankName || secondRow.Employee?.BankName || null,
                accountNumber: bankRow.Employee?.AccountNumber || secondRow.Employee?.AccountNumber || null,
                ifscCode: bankRow.Employee?.IFSCCode || secondRow.Employee?.IFSCCode || null,
                bankBranch: bankRow.Employee?.BankBranch || secondRow.Employee?.BankBranch || null,
                // Education details from Employee table columns (from education query)
                qualification: educationRow.Employee?.Qualification || null,
                institutionName: educationRow.Employee?.InstitutionName || null,
                fieldOfStudy: educationRow.Employee?.FieldOfStudy || null,
                yearOfCompletion: educationRow.Employee?.YearOfCompletion || null,
                percentageMarks: educationRow.Employee?.PercentageMarks || null,
                photoFileId: fourthRow.Employee?.PhotoFileId || null,
                photoFileName: fourthRow.Employee?.PhotoFileName || null,
                aadharCopyFileId: fourthRow.Employee?.AadharCopyFileId || null,
                aadharCopyFileName: fourthRow.Employee?.AadharCopyFileName || null,
                pFEpassbookFileId: fourthRow.Employee?.PFEpassbookFileId || null,
                pFEpassbookFileName: fourthRow.Employee?.PFEpassbookFileName || null,
                educationalCertificatesFileId: fourthRow.Employee?.EducationalCertificatesFileId || null,
                educationalCertificatesFileName: fourthRow.Employee?.EducationalCertificatesFileName || null,
                bankPassbookFileId: fourthRow.Employee?.BankPassbookFileId || null,
                bankPassbookFileName: fourthRow.Employee?.BankPassbookFileName || null,
                experienceCertificateFileId: fourthRow.Employee?.ExperienceCertificateFileId || null,
                experienceCertificateFileName: fourthRow.Employee?.ExperienceCertificateFileName || null,
                pANCardFileId: fourthRow.Employee?.PANCardFileId || null,
                pANCardFileName: fourthRow.Employee?.PANCardFileName || null,
                resumeFileId: fourthRow.Employee?.ResumeFileId || null,
                resumeFileName: fourthRow.Employee?.ResumeFileName || null,
                addedUser: secondRow.Employee?.Added_User || null,
                modifiedUser: secondRow.Employee?.Modified_User || null,
                addedTime: row.Employee.CREATEDTIME || null,
                modifiedTime: row.Employee.MODIFIEDTIME || null,
            };
        });
        
        // Build education details array from Employee table columns and JSON fallback
        // Use the educationQueryMap that was already created above
        for (const emp of employees) {
            const eduDetails = [];
            const educationRow = educationQueryMap.get(emp.id) || {};
            
            // First, try to get from JSON (if all entries were stored as JSON fallback)
            if (educationRow.Employee && educationRow.Employee.EducationDetailsJSON) {
                try {
                    const jsonEduDetails = JSON.parse(educationRow.Employee.EducationDetailsJSON);
                    if (Array.isArray(jsonEduDetails) && jsonEduDetails.length > 0) {
                        // Use JSON data if available (contains all entries)
                        jsonEduDetails.forEach(edu => {
                            if (edu && (edu.qualification || edu.institutionName || edu.fieldOfStudy || edu.yearOfCompletion || edu.percentageMarks)) {
                                eduDetails.push({
                                    qualification: edu.qualification || null,
                                    institutionName: edu.institutionName || null,
                                    fieldOfStudy: edu.fieldOfStudy || null,
                                    yearOfCompletion: edu.yearOfCompletion || null,
                                    percentageMarks: edu.percentageMarks || null
                                });
                            }
                        });
                        console.log(`Employee ${emp.employeeCode} - Found ${eduDetails.length} education entries from JSON`);
                    }
                } catch (parseErr) {
                    console.error(`Error parsing education JSON for employee ${emp.id}:`, parseErr);
                }
            }
            
            // If no JSON data, use individual columns (first entry only)
            if (eduDetails.length === 0) {
                const qual = educationRow.Employee?.Qualification || emp.qualification;
                const inst = educationRow.Employee?.InstitutionName || emp.institutionName;
                const field = educationRow.Employee?.FieldOfStudy || emp.fieldOfStudy;
                const year = educationRow.Employee?.YearOfCompletion || emp.yearOfCompletion;
                const marks = educationRow.Employee?.PercentageMarks || emp.percentageMarks;
                
                if (qual || inst || field || year || marks) {
                    eduDetails.push({
                        qualification: qual || null,
                        institutionName: inst || null,
                        fieldOfStudy: field || null,
                        yearOfCompletion: year || null,
                        percentageMarks: marks || null
                    });
                }
            }
            
            // Try to fetch additional entries from EmployeeEducation table if it exists
            try {
                const additionalEduQuery = `SELECT * FROM EmployeeEducation WHERE EmployeeID = '${emp.id}'`;
                const educationResults = await zcql.executeZCQLQuery(additionalEduQuery);
                
                educationResults.forEach(eduRow => {
                    if (eduRow.EmployeeEducation) {
                        eduDetails.push({
                            qualification: eduRow.EmployeeEducation.Qualification || null,
                            institutionName: eduRow.EmployeeEducation.InstitutionName || null,
                            fieldOfStudy: eduRow.EmployeeEducation.FieldOfStudy || null,
                            yearOfCompletion: eduRow.EmployeeEducation.YearOfCompletion || null,
                            percentageMarks: eduRow.EmployeeEducation.PercentageMarks || null
                        });
                    }
                });
            } catch (eduErr) {
                // EmployeeEducation table doesn't exist, that's okay
                if (!eduErr.message || (!eduErr.message.includes('No such Table') && !eduErr.message.includes('Unkown Table'))) {
                    console.error(`Error fetching additional education from EmployeeEducation table for employee ${emp.id}:`, eduErr);
                }
            }
            
            emp.educationDetails = eduDetails;
            
            // Debug: Log education details for first employee
            if (emp.id === employees[0]?.id && emp.educationDetails.length > 0) {
                console.log(`Employee ${emp.employeeCode} education details:`, JSON.stringify(emp.educationDetails));
            }
        }
        
        console.log(`Total employees with education details: ${employees.filter(emp => emp.educationDetails && emp.educationDetails.length > 0).length} out of ${employees.length}`);

        res.status(200).send({
            status: 'success',
            data: {
                employees,
                total, // Added total count to response
                hasMore: returnAll ? false : page * perPage < total
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// GET: Total Employees count
app.get('/employees/count', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userEmail = req.query.userEmail; // Get user email from query params
        const userRole = req.query.userRole; // Get user role from query params
       
        console.log('Employee count request:', { userEmail, userRole });
        const zcql = catalyst.zcql();

        // Build WHERE clause for contractor filtering and active status
        let countWhereClause = '';
        let contractorName = null; // Declare outside if block for fallback access
       
        // For dashboard counts, App Users see only their contractor's employees
        // For employee management page, App Users see all employees
        const isDashboardCount = req.query.dashboard === 'true';
        
        // Build WHERE clause conditions
        const whereConditions = [];
        
        // Always filter by active status
        whereConditions.push("(employeeStatus = 'Active' OR EmployeeStatus = 'Active')");
        
        if (userRole === 'App User' && userEmail && isDashboardCount) {
            // Dashboard count - show contractor-specific employees only
           
            // Use the same contractor mapping logic for dashboard counts
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                contractorName = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                        console.log(`Found contractor for dashboard count: ${contractorName}`);
                    }
                } catch (error) {
                    console.error('Error finding contractor for dashboard count:', error);
                }
            }
           
            if (contractorName) {
                // Escape single quotes in contractor name to prevent SQL injection
                const escapedContractorName = contractorName.replace(/'/g, "''");
                // Use LOWER() for case-insensitive matching (same as employees endpoint)
                whereConditions.push(`LOWER(ContractorName) = LOWER('${escapedContractorName}')`);
                console.log(`Dashboard count filtering for contractor (case-insensitive): ${contractorName}`);
            }
        } else if (userRole === 'App User' && userEmail && !isDashboardCount) {
            // Employee management page - show all employees (but still only active)
            console.log(`=== DEBUG: App User ${userEmail} - counting all active employees for management page`);
        }
        
        // Combine all WHERE conditions
        if (whereConditions.length > 0) {
            countWhereClause = `WHERE ${whereConditions.join(' AND ')}`;
        }

        // Get total count with contractor filter and active status
        let total = 0;
        try {
        const countQuery = `SELECT COUNT(ROWID) as count FROM Employee ${countWhereClause}`;
            console.log('Employee count query:', countQuery);
            console.log('Count where clause:', countWhereClause);
        const countRows = await zcql.executeZCQLQuery(countQuery);
            console.log('Count query result:', countRows);
            total = parseInt(countRows[0].Employee['COUNT(ROWID)']) || 0;
            console.log('Total active employee count from SQL:', total);
            
            // If SQL query returned 0 but we have a contractor filter, try JavaScript fallback as double-check
            if (total === 0 && contractorName && countWhereClause) {
                console.log('SQL query returned 0, trying JavaScript fallback to verify...');
                try {
                    const allEmployeesQuery = `SELECT ROWID, ContractorName, employeeStatus, EmployeeStatus FROM Employee`;
                    const allEmployees = await zcql.executeZCQLQuery(allEmployeesQuery);
                    const normalizedContractor = contractorName.replace(/\s+/g, ' ').trim().toLowerCase();
                    const uniqueContractors = [...new Set(allEmployees.map(e => e.Employee?.ContractorName).filter(Boolean))];
                    console.log('Available contractor names in database:', uniqueContractors.slice(0, 10));
                    console.log('Looking for contractor:', normalizedContractor);
                    
                    const filtered = allEmployees.filter(emp => {
                        // Check active status first
                        const status = emp.Employee?.employeeStatus || emp.Employee?.EmployeeStatus || '';
                        if (status !== 'Active') return false;
                        
                        // Then check contractor
                        const empContractor = (emp.Employee?.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
                        if (empContractor === normalizedContractor) return true;
                        // Try matching key words
                        const searchWords = normalizedContractor.split(' ').filter(w => w.length > 2);
                        if (searchWords.length > 0) {
                            const allKeyWordsMatch = searchWords.every(word => empContractor.includes(word));
                            if (allKeyWordsMatch) {
                                const firstSearchWord = searchWords[0];
                                const empFirstWord = empContractor.split(' ')[0];
                                if (empFirstWord && (empFirstWord.startsWith(firstSearchWord) || firstSearchWord.startsWith(empFirstWord))) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    });
                    const jsCount = filtered.length;
                    if (jsCount > 0) {
                        console.log('JavaScript fallback found', jsCount, 'active employees (SQL returned 0)');
                        total = jsCount;
                    } else {
                        console.log('JavaScript fallback also found 0 active employees');
                    }
                } catch (jsError) {
                    console.error('JavaScript fallback error:', jsError);
                }
            }
        } catch (queryError) {
            console.error('Error executing count query:', queryError);
            // Fallback: fetch all employees and filter in JavaScript
                try {
                console.log('Falling back to JavaScript filtering for active employees' + (contractorName ? ` and contractor: ${contractorName}` : ''));
                const allEmployeesQuery = `SELECT ROWID, ContractorName, employeeStatus, EmployeeStatus FROM Employee`;
                    const allEmployees = await zcql.executeZCQLQuery(allEmployeesQuery);
                
                // Filter by active status first
                let filtered = allEmployees.filter(emp => {
                    const status = emp.Employee?.employeeStatus || emp.Employee?.EmployeeStatus || '';
                    return status === 'Active';
                });
                
                // Then filter by contractor if specified
                if (contractorName) {
                    // Normalize contractor name: remove extra spaces, convert to lowercase
                    const normalizedContractor = contractorName.replace(/\s+/g, ' ').trim().toLowerCase();
                    // Get unique contractor names from database for debugging
                    const uniqueContractors = [...new Set(filtered.map(e => e.Employee?.ContractorName).filter(Boolean))];
                    console.log('Available contractor names in database:', uniqueContractors.slice(0, 10));
                    console.log('Looking for contractor:', normalizedContractor);
                    
                    filtered = filtered.filter(emp => {
                        const empContractor = (emp.Employee?.ContractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
                        // Try exact match first
                        if (empContractor === normalizedContractor) return true;
                        // Try matching key words (handles variations like "Samuel Enterprise" vs "Samuel Enterprises")
                        // Check if the contractor name contains all the key words from our search term
                        const searchWords = normalizedContractor.split(' ').filter(w => w.length > 2); // Ignore short words like "for", "the"
                        if (searchWords.length > 0) {
                            const allKeyWordsMatch = searchWords.every(word => empContractor.includes(word));
                            if (allKeyWordsMatch) {
                                // Additional validation: the first word should match (e.g., "samuel")
                                const firstSearchWord = searchWords[0];
                                const empFirstWord = empContractor.split(' ')[0];
                                if (empFirstWord && (empFirstWord.startsWith(firstSearchWord) || firstSearchWord.startsWith(empFirstWord))) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    });
                }
                    total = filtered.length;
                console.log('Fallback count result:', total, 'active employees out of', allEmployees.length, 'total employees');
                    if (total === 0 && allEmployees.length > 0) {
                        console.log('Sample contractor names in database:', 
                            [...new Set(allEmployees.slice(0, 20).map(e => e.Employee?.ContractorName).filter(Boolean))]);
                    }
                } catch (fallbackError) {
                    console.error('Fallback query also failed:', fallbackError);
                    total = 0;
            }
        }
       
        res.json({ count: total });
    } catch (err) {
        console.error('Employee count error:', err);
        res.status(500).json({ error: 'Failed to get employee count' });
    }
});

// GET API: Get all distinct Category values (for Setup Configuration LOH/OT "Category Applicable To")
// Uses same userRole/userEmail filtering as /employees so App Users see only their contractor's categories
app.get('/employees/categories', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
        const zcql = catalyst.zcql();

        let whereClause = '';
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                try {
                    const q = await zcql.executeZCQLQuery(`SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Samuel%' LIMIT 1`);
                    if (q && q.length > 0) contractorName = q[0].Employee?.ContractorName || "Samuel Enterprises";
                    else contractorName = "Samuel Enterprises";
                } catch (_) { contractorName = "Samuel Enterprises"; }
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${String(userEmail).replace(/'/g, "''")}'`
                    );
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                    }
                } catch (err) { console.error('Categories contractor lookup error:', err); }
            }
            if (contractorName) {
                const escaped = String(contractorName).trim().replace(/'/g, "''");
                if (escaped.toLowerCase().includes('samuel')) {
                    whereClause = ` WHERE ContractorName LIKE '%Samuel%'`;
                } else {
                    whereClause = ` WHERE LOWER(ContractorName) = LOWER('${escaped}')`;
                }
            }
        }

        const query = `SELECT Category FROM Employee${whereClause}`;
        const rows = await zcql.executeZCQLQuery(query);
        const categories = [...new Set(
            (rows || [])
                .map((r) => (r.Employee?.Category || '').toString().trim())
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        res.status(200).json({
            status: 'success',
            data: { categories }
        });
    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({
            status: 'failure',
            message: err.message || 'Failed to fetch categories'
        });
    }
});

// GET API: Get a single employee by ROWID
app.get('/employees/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        // Get employee data with all fields
        const firstQuery = await zcql.executeZCQLQuery(`
            SELECT * FROM Employee WHERE ROWID = '${ROWID}'
        `);

        if (firstQuery.length === 0) {
            return res.status(404).json({
                status: 'failure',
                message: 'Employee not found'
            });
        }

        const row = firstQuery[0];
        const employee = {
            id: row.Employee.ROWID,
            employeeCode: row.Employee.EmployeeCode,
            employeeName: row.Employee.EmployeeName,
            personalEmail: row.Employee.Personalemailaddress,
            phone: row.Employee.Phone,
            dateOfJoining: row.Employee.DateofJoining,
            dateOfExit: row.Employee.DateofExit,
            overallExperience: row.Employee.OverallExperience,
            relevantExperience: row.Employee.RelevantExperience,
            sourceOfHire: row.Employee.SourceofHire,
            pfNo: row.Employee.PFNo,
            esicNo: row.Employee.ESICNo,
            pfStatus: row.Employee.PFStatus || null,
            esiStatus: row.Employee.ESIStatus || null,
            location: row.Employee.Location,
            gradeLevel: row.Employee.GradeLevel,
            uanNo: row.Employee.UANNo,
            contractor: row.Employee.ContractorName,
            employmentType: row.Employee.EmploymentType,
            department: row.Employee.Department,
            designation: row.Employee.Designation,
            employeeStatus: row.Employee.employeeStatus,
            aadhaarNumber: row.Employee.aadhaarNumber,
            panNumber: row.Employee.panNumber,
            dateOfBirth: row.Employee.DateofBirth,
            fathersName: row.Employee.FathersName,
            age: row.Employee.Age,
            emergencyContactNumber: row.Employee?.EmergencyContactNumber || null,
            emergencyContactName: row.Employee?.EmergencyContactName || null,
            emergencyContactAddress: row.Employee?.EmergencyContactAddress || null,
            emergencyCity: row.Employee?.EmergencyCity || null,
            emergencyState: row.Employee?.EmergencyState || null,
            emergencyPostalCode: row.Employee?.EmergencyPostalCode || null,
            spouse: row.Employee?.Spouse || null,
            gender: row.Employee.Gender,
            bloodGroup: row.Employee.BloodGroup,
            maritalStatus: row.Employee.MaritalStatus,
            presentAddressLine1: row.Employee.PresentAddressLine1,
            presentAddressLine2: row.Employee.PresentAddressLine2,
            presentCity: row.Employee.PresentCity,
            presentState: row.Employee.PresentState,
            presentPostalCode: row.Employee.PresentPostalCode,
            presentCountry: row.Employee.PresentCountry,
            permanentAddressLine1: row.Employee.PermanentAddressLine1,
            permanentAddressLine2: row.Employee.PermanentAddressLine2,
            permanentCity: row.Employee.PermanentCity,
            permanentState: row.Employee.PermanentState,
            permanentPostalCode: row.Employee.PermanentPostalCode,
            permanentCountry: row.Employee.PermanentCountry,
            actualBasic: row.Employee.ActualBasic,
            actualHRA: row.Employee.ActualHRA,
            actualSpecialAllowance: row.Employee.ActualSpecialAllowance,
            actualDA: row.Employee.ActualDA,
            attendanceAllowance: row.Employee.AttendanceAllowance,
            otherAllowance: row.Employee.OtherAllowance,
            travelChargers:
              row.Employee.TravelChargers ??
              row.Employee.travelChargers ??
              row.Employee.TravelCharges ??
              row.Employee.travelCharges ??
              null,
            foodAllowance: row.Employee.FoodAllowance,
            uniformAllowance: row.Employee.UniformAllowance,
            totalSalary: row.Employee.TotalSalary,
            revisedActualBasic: row.Employee.RevisedActualBasic,
            revisedActualHRA: row.Employee.RevisedActualHRA,
            revisedActualDA: row.Employee.RevisedActualDA,
            revisedOtherAllowance: row.Employee.RevisedOtherAllowance,
            revisedTotalSalary: row.Employee.RevisedTotalSalary,
            monthData: row.Employee.MonthData,
            dateData: row.Employee.DateData,
            photoFileId: row.Employee.PhotoFileId,
            photoFileName: row.Employee.PhotoFileName,
            aadharCopyFileId: row.Employee.AadharCopyFileId,
            aadharCopyFileName: row.Employee.AadharCopyFileName,
            pFEpassbookFileId: row.Employee.PFEpassbookFileId,
            pFEpassbookFileName: row.Employee.PFEpassbookFileName,
            educationalCertificatesFileId: row.Employee.EducationalCertificatesFileId,
            educationalCertificatesFileName: row.Employee.EducationalCertificatesFileName,
            bankPassbookFileId: row.Employee.BankPassbookFileId,
            bankPassbookFileName: row.Employee.BankPassbookFileName,
            experienceCertificateFileId: row.Employee.ExperienceCertificateFileId,
            experienceCertificateFileName: row.Employee.ExperienceCertificateFileName,
            pANCardFileId: row.Employee.PANCardFileId,
            pANCardFileName: row.Employee.PANCardFileName,
            resumeFileId: row.Employee.ResumeFileId,
            resumeFileName: row.Employee.ResumeFileName,
            category: row.Employee.Category,
            secondaryContactNumber: row.Employee.SecondaryContactNumber,
            drivingLicenseNumber: row.Employee.DrivingLicenseNumber,
            drivingLicenseExpiryDate: row.Employee.DrivingLicenseExpiryDate,
            bankHolderName: row.Employee.BankHolderName || null,
            bankName: row.Employee.BankName || null,
            accountNumber: row.Employee.AccountNumber || null,
            ifscCode: row.Employee.IFSCCode || null,
            bankBranch: row.Employee.BankBranch || null,
            qualification: row.Employee.Qualification,
            institutionName: row.Employee.InstitutionName,
            fieldOfStudy: row.Employee.FieldOfStudy,
            yearOfCompletion: row.Employee.YearOfCompletion,
            percentageMarks: row.Employee.PercentageMarks,
            addedUser: row.Employee.Added_User,
            modifiedUser: row.Employee.Modified_User,
            addedTime: row.Employee.Added_Time,
            modifiedTime: row.Employee.Modified_Time
        };

        // Build education details array (same logic as GET all employees endpoint)
        const eduDetails = [];
        
        // First, try to get from JSON (if all entries were stored as JSON)
        if (row.Employee.EducationDetailsJSON) {
            try {
                const jsonEduDetails = JSON.parse(row.Employee.EducationDetailsJSON);
                if (Array.isArray(jsonEduDetails) && jsonEduDetails.length > 0) {
                    // Use JSON data if available (contains all entries)
                    jsonEduDetails.forEach(edu => {
                        if (edu && (edu.qualification || edu.institutionName || edu.fieldOfStudy || edu.yearOfCompletion || edu.percentageMarks)) {
                            eduDetails.push({
                                qualification: edu.qualification || null,
                                institutionName: edu.institutionName || null,
                                fieldOfStudy: edu.fieldOfStudy || null,
                                yearOfCompletion: edu.yearOfCompletion || null,
                                percentageMarks: edu.percentageMarks || null
                            });
                        }
                    });
                    console.log(`GET single employee - Found ${eduDetails.length} education entries from JSON`);
                }
            } catch (parseErr) {
                console.error(`Error parsing EducationDetailsJSON for employee ${ROWID}:`, parseErr);
            }
        }
        
        // If no JSON data, use individual columns (first entry only)
        if (eduDetails.length === 0) {
            const qual = row.Employee.Qualification;
            const inst = row.Employee.InstitutionName;
            const field = row.Employee.FieldOfStudy;
            const year = row.Employee.YearOfCompletion;
            const marks = row.Employee.PercentageMarks;
            
            if (qual || inst || field || year || marks) {
                eduDetails.push({
                    qualification: qual || null,
                    institutionName: inst || null,
                    fieldOfStudy: field || null,
                    yearOfCompletion: year || null,
                    percentageMarks: marks || null
                });
            }
        }
        
        // Try to fetch additional entries from EmployeeEducation table if it exists
        try {
            const additionalEduQuery = `SELECT * FROM EmployeeEducation WHERE EmployeeID = '${ROWID}'`;
            const educationResults = await zcql.executeZCQLQuery(additionalEduQuery);
            
            educationResults.forEach(eduRow => {
                if (eduRow.EmployeeEducation) {
                    eduDetails.push({
                        qualification: eduRow.EmployeeEducation.Qualification || null,
                        institutionName: eduRow.EmployeeEducation.InstitutionName || null,
                        fieldOfStudy: eduRow.EmployeeEducation.FieldOfStudy || null,
                        yearOfCompletion: eduRow.EmployeeEducation.YearOfCompletion || null,
                        percentageMarks: eduRow.EmployeeEducation.PercentageMarks || null
                    });
                }
            });
            if (educationResults.length > 0) {
                console.log(`GET single employee - Found ${educationResults.length} additional education entries from EmployeeEducation table`);
            }
        } catch (eduErr) {
            // EmployeeEducation table doesn't exist, that's okay
            if (!eduErr.message || (!eduErr.message.includes('No such Table') && !eduErr.message.includes('Unkown Table'))) {
                console.error(`Error fetching additional education from EmployeeEducation table for employee ${ROWID}:`, eduErr);
            }
        }
        
        // Add educationDetails array to employee object
        employee.educationDetails = eduDetails;
        console.log(`GET single employee ${ROWID} - Total education entries: ${eduDetails.length}`);

        res.json({
            status: 'success',
            data: { employee }
        });
    } catch (err) {
        console.error('Get employee error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fetch employee details'
        });
    }
});

// POST API: Add a new employee
app.post('/employees', async (req, res) => {
    try {
        const {
            employeeCode, employeeName, personalEmail, phone, dateOfJoining, dateOfExit, overallExperience,
            relevantExperience, sourceOfHire, pfNo, esicNo, pfStatus, esiStatus, location, gradeLevel, uanNo, dateOfBirth,
            fathersName, age, emergencyContactNumber, emergencyContactName, emergencyContactAddress, emergencyCity, emergencyState, emergencyPostalCode, spouse, gender, bloodGroup, maritalStatus,
            presentAddressLine1, presentAddressLine2, presentCity, presentState, presentPostalCode,
            presentCountry, permanentAddressLine1, permanentAddressLine2, permanentCity,
            permanentState, permanentPostalCode, permanentCountry,
            actualBasic, actualHRA, actualSpecialAllowance, actualDA, attendanceAllowance, otherAllowance, travelChargers, foodAllowance, uniformAllowance, totalSalary,
            revisedActualBasic, revisedActualHRA, revisedActualDA, revisedOtherAllowance, revisedTotalSalary, monthData, dateData,
            aadhaarNumber, panNumber, employeeStatus, department, designation, contractor,
            employmentType, category,
            secondaryContactNumber,
            drivingLicenseNumber, drivingLicenseExpiryDate,
            bankHolderName, bankName, accountNumber, ifscCode, bankBranch,
            qualification, institutionName, fieldOfStudy, yearOfCompletion, percentageMarks,
            educationDetails, // Array of education details
            // File-related fields
            photoFileId, photoFileName,
            aadharCopyFileId, aadharCopyFileName,
            drivingLicenceFileId, drivingLicenceFileName,
            pFEpassbookFileId, pFEpassbookFileName,
            educationalCertificatesFileId, educationalCertificatesFileName,
            bankPassbookFileId, bankPassbookFileName,
            experienceCertificateFileId, experienceCertificateFileName,
            pANCardFileId, pANCardFileName,
            resumeFileId, resumeFileName
        } = req.body;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Employee');

        // Validate mandatory fields
        if (!employeeCode || !employeeName) {
            return res.status(400).send({
                status: 'failure',
                message: 'Employee Code and Name are required.'
            });
        }

        // Helper function to parse numeric fields
        const parseNumeric = (value) => {
            if (value == null) return null;
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                if (value.trim() === '') return null;
                const parsed = parseInt(value.trim(), 10);
                return isNaN(parsed) ? null : parsed;
            }
            // For any other type, try to convert to string and parse
            const strValue = String(value).trim();
            if (strValue === '') return null;
            const parsed = parseInt(strValue, 10);
            return isNaN(parsed) ? null : parsed;
        };

        const userManagement = catalyst.userManagement();
        const userProfile = await userManagement.getCurrentUser();
        const userEmail = userProfile?.email_id || null;
        const userRole = req.query.userRole; // Get user role from query params
        
        console.log('Employee creation request:', { userEmail, userRole, contractor });

        // Auto-assign contractor name for App Users
        let finalContractorName = contractor;
        if (userRole === 'App User' && userEmail) {
            let assignedContractorName = null;
            
            // Use the same logic as in the GET endpoint to find contractor name
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                assignedContractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                assignedContractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                assignedContractorName = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                assignedContractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                assignedContractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const zcql = catalyst.zcql();
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        assignedContractorName = contractorQuery[0].Contractors.ContractorName;
                        console.log(`Found contractor for email ${userEmail}: ${assignedContractorName}`);
                    }
                } catch (error) {
                    console.error('Error finding contractor for App User:', error);
                }
            }
            
            if (assignedContractorName) {
                finalContractorName = assignedContractorName;
                console.log(`Auto-assigned contractor for App User ${userEmail}: ${assignedContractorName}`);
            }
        }

        // Debug: Log file-related fields
        console.log('Creating employee with file fields:', {
            photoFileId, photoFileName,
            aadharCopyFileId, aadharCopyFileName,
            drivingLicenceFileId, drivingLicenceFileName,
            pFEpassbookFileId, pFEpassbookFileName,
            educationalCertificatesFileId, educationalCertificatesFileName,
            bankPassbookFileId, bankPassbookFileName,
            experienceCertificateFileId, experienceCertificateFileName,
            pANCardFileId, pANCardFileName,
            resumeFileId, resumeFileName
        });

        // Debug: Log emergency contact fields being saved (POST)
        console.log('POST - Emergency contact fields received:', {
            emergencyContactName: emergencyContactName,
            emergencyContactAddress: emergencyContactAddress,
            emergencyCity: emergencyCity,
            emergencyState: emergencyState,
            emergencyPostalCode: emergencyPostalCode,
            spouse: spouse
        });

        // If this EmployeeCode already exists, update that row instead of inserting (import / API upsert)
        const zcqlPost = catalyst.zcql();
        const escapedEmployeeCodeForDup = String(employeeCode).trim().replace(/'/g, "''");
        let existingRowIdForUpsert = null;
        try {
            const dupRows = await zcqlPost.executeZCQLQuery(
                `SELECT ROWID FROM Employee WHERE EmployeeCode = '${escapedEmployeeCodeForDup}' LIMIT 1`
            );
            if (dupRows && dupRows.length > 0 && dupRows[0].Employee && dupRows[0].Employee.ROWID) {
                existingRowIdForUpsert = dupRows[0].Employee.ROWID;
            }
        } catch (dupErr) {
            console.log('POST employees duplicate check:', dupErr.message);
        }
        
        // Insert new employee row (add DateofExit) — or update when same code exists
        const newRowPayload = {
            EmployeeCode: employeeCode,
            EmployeeName: employeeName,
            Personalemailaddress: personalEmail,
            Phone: parseNumeric(phone),
            DateofJoining: dateOfJoining || null,
            DateofExit: dateOfExit || null, // <-- Added here
            OverallExperience: overallExperience || null,
            RelevantExperience: relevantExperience || null,
            SourceofHire: sourceOfHire || null,
            PFNo: pfNo || null,
            ESICNo: parseNumeric(esicNo),
            PFStatus: pfStatus || null,
            ESIStatus: esiStatus || null,
            Location: location || null,
            GradeLevel: gradeLevel || null,
            UANNo: uanNo || null,
            DateofBirth: dateOfBirth || null,
            FathersName: fathersName || null,
            Age: parseNumeric(age),
            EmergencyContactNumber: parseNumeric(emergencyContactNumber),
            EmergencyContactName: emergencyContactName || null,
            EmergencyContactAddress: emergencyContactAddress || null,
            EmergencyCity: emergencyCity || null,
            EmergencyState: emergencyState || null,
            EmergencyPostalCode: emergencyPostalCode || null,
            Spouse: spouse || null,
            Gender: gender || null,
            BloodGroup: bloodGroup || null,
            MaritalStatus: maritalStatus || null,
            PresentAddressLine1: presentAddressLine1 || null,
            PresentAddressLine2: presentAddressLine2 || null,
            PresentCity: presentCity || null,
            PresentState: presentState || null,
            PresentPostalCode: presentPostalCode || null,
            PresentCountry: presentCountry || null,
            PermanentAddressLine1: permanentAddressLine1 || null,
            PermanentAddressLine2: permanentAddressLine2 || null,
            PermanentCity: permanentCity || null,
            PermanentState: permanentState || null,
            PermanentPostalCode: permanentPostalCode || null,
            PermanentCountry: permanentCountry || null,
            ActualBasic: actualBasic != null && actualBasic !== '' ? actualBasic : null,
            ActualHRA: actualHRA != null && actualHRA !== '' ? actualHRA : null,
            ActualSpecialAllowance: actualSpecialAllowance != null && actualSpecialAllowance !== '' ? actualSpecialAllowance : null,
            SpecialAllowance: actualSpecialAllowance != null && actualSpecialAllowance !== '' ? actualSpecialAllowance : null,
            ActualDA: actualDA != null && actualDA !== '' ? actualDA : null,
            AttendanceAllowance: attendanceAllowance != null && attendanceAllowance !== '' ? attendanceAllowance : null,
            OtherAllowance: otherAllowance != null && otherAllowance !== '' ? otherAllowance : null,
            TravelChargers: travelChargers != null && travelChargers !== '' ? travelChargers : null,
            FoodAllowance: foodAllowance != null && foodAllowance !== '' ? foodAllowance : null,
            UniformAllowance: uniformAllowance != null && uniformAllowance !== '' ? uniformAllowance : null,
            TotalSalary: totalSalary != null && totalSalary !== '' ? totalSalary : null,
            RevisedActualBasic: revisedActualBasic != null && revisedActualBasic !== '' ? revisedActualBasic : null,
            RevisedActualHRA: revisedActualHRA != null && revisedActualHRA !== '' ? revisedActualHRA : null,
            RevisedActualDA: revisedActualDA != null && revisedActualDA !== '' ? revisedActualDA : null,
            RevisedOtherAllowance: revisedOtherAllowance != null && revisedOtherAllowance !== '' ? revisedOtherAllowance : null,
            RevisedTotalSalary: revisedTotalSalary != null && revisedTotalSalary !== '' ? revisedTotalSalary : null,
            MonthData: monthData || null,
            DateData: dateData || null,
            aadhaarNumber: aadhaarNumber || null,
            panNumber: panNumber || null,
            employeeStatus: employeeStatus || null,
            Department: (department && String(department).trim()) ? String(department).trim().toUpperCase() : (department || null),
            Designation: (designation && String(designation).trim()) ? String(designation).trim().toUpperCase() : (designation || null),
            EmploymentType: employmentType || null,
            ContractorName: finalContractorName || null,
            Category: (category && String(category).trim()) ? String(category).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : (category || null),
            SecondaryContactNumber: secondaryContactNumber || null,
            DrivingLicenseNumber: drivingLicenseNumber || null,
            DrivingLicenseExpiryDate: drivingLicenseExpiryDate || null,
            BankHolderName: bankHolderName || null,
            BankName: bankName || null,
            AccountNumber: accountNumber || null,
            IFSCCode: ifscCode || null,
            BankBranch: bankBranch || null,
            // Save first education entry to Employee table columns
            Qualification: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].qualification || null) 
                : (qualification || null),
            InstitutionName: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].institutionName || null) 
                : (institutionName || null),
            FieldOfStudy: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].fieldOfStudy || null) 
                : (fieldOfStudy || null),
            YearOfCompletion: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].yearOfCompletion || null) 
                : (yearOfCompletion || null),
            PercentageMarks: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].percentageMarks || null) 
                : (percentageMarks || null),
            // File-related fields
            PhotoFileId: photoFileId || null,
            PhotoFileName: photoFileName || null,
            AadharCopyFileId: aadharCopyFileId || null,
            AadharCopyFileName: aadharCopyFileName || null,
            PFEpassbookFileId: pFEpassbookFileId || null,
            PFEpassbookFileName: pFEpassbookFileName || null,
            EducationalCertificatesFileId: educationalCertificatesFileId || null,
            EducationalCertificatesFileName: educationalCertificatesFileName || null,
            BankPassbookFileId: bankPassbookFileId || null,
            BankPassbookFileName: bankPassbookFileName || null,
            ExperienceCertificateFileId: experienceCertificateFileId || null,
            ExperienceCertificateFileName: experienceCertificateFileName || null,
            PANCardFileId: pANCardFileId || null,
            PANCardFileName: pANCardFileName || null,
            ResumeFileId: resumeFileId || null,
            ResumeFileName: resumeFileName || null,
            Added_User: userEmail,
            Modified_User: userEmail
        };

        let id;
        if (existingRowIdForUpsert) {
            console.log(`POST employees: EmployeeCode "${employeeCode}" exists (ROWID ${existingRowIdForUpsert}), updating instead of insert`);
            const existingRowBefore = await table.getRow(existingRowIdForUpsert);
            await table.updateRow({
                ROWID: existingRowIdForUpsert,
                ...newRowPayload,
                Added_User: existingRowBefore.Added_User || existingRowBefore.added_User || userEmail,
                Modified_User: userEmail
            });
            id = existingRowIdForUpsert;
        } else {
            const { ROWID: newId } = await table.insertRow(newRowPayload);
            id = newId;
        }
        
        // Save all education entries - try JSON first, then EmployeeEducation table, then individual columns
        console.log('POST - Education details received:', JSON.stringify(educationDetails));
        console.log('POST - Education details type:', typeof educationDetails, 'isArray:', Array.isArray(educationDetails));
        
        if (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0) {
            // Filter out empty entries
            const allEducationDetails = educationDetails.filter(edu => 
                edu && (edu.qualification || edu.institutionName || edu.fieldOfStudy || edu.yearOfCompletion || edu.percentageMarks)
            );
            
            console.log(`POST - Processing ${allEducationDetails.length} education entries`);
            if (allEducationDetails.length > 0) {
                console.log('POST - First education entry that was saved to Employee table columns:', JSON.stringify(allEducationDetails[0]));
            }
            
            // Strategy 1: Try to save ALL entries as JSON in EducationDetailsJSON column (preferred method)
            try {
                await table.updateRow({
                    ROWID: id,
                    EducationDetailsJSON: JSON.stringify(allEducationDetails)
                });
                console.log(`Successfully saved all ${allEducationDetails.length} education entries as JSON in EducationDetailsJSON column`);
            } catch (jsonErr) {
                console.log('EducationDetailsJSON column not available, trying EmployeeEducation table:', jsonErr.message);
                
                // Strategy 2: If JSON column doesn't exist, try to save additional entries to EmployeeEducation table
                if (allEducationDetails.length > 1) {
                    const additionalEducationDetails = allEducationDetails.slice(1);
                    try {
                        const educationTable = catalyst.datastore().table('EmployeeEducation');
                        let savedCount = 0;
                        for (const edu of additionalEducationDetails) {
                            try {
                                const eduData = {
                                    EmployeeID: id,
                                    Qualification: edu.qualification || null,
                                    InstitutionName: edu.institutionName || null,
                                    FieldOfStudy: edu.fieldOfStudy || null,
                                    YearOfCompletion: edu.yearOfCompletion || null,
                                    PercentageMarks: edu.percentageMarks || null
                                };
                                console.log('Saving additional education entry to EmployeeEducation table:', JSON.stringify(eduData));
                                await educationTable.insertRow(eduData);
                                savedCount++;
                                console.log(`Successfully saved additional education entry ${savedCount}`);
                            } catch (eduErr) {
                                console.error('Error saving additional education detail:', eduErr);
                                // Continue with other education entries even if one fails
                            }
                        }
                        console.log(`Total additional education entries saved to EmployeeEducation table: ${savedCount} out of ${additionalEducationDetails.length}`);
                    } catch (tableErr) {
                        console.log('EmployeeEducation table not available:', tableErr.message);
                        console.log('Note: Only the first education entry is saved in Employee table columns. To store multiple entries, please add the "EducationDetailsJSON" column (Long Text/String) to the Employee table in Zoho Catalyst.');
                    }
                } else {
                    console.log('Only one education entry provided, saved to Employee table columns');
                }
            }
        } else {
            console.log('No education details provided');
        }
        
        // Fetch the full employee row after insert to verify education details were saved
        const employeeRow = await table.getRow(id);
        console.log('POST - Employee row after insert - Education fields:', {
            Qualification: employeeRow.Qualification,
            InstitutionName: employeeRow.InstitutionName,
            FieldOfStudy: employeeRow.FieldOfStudy,
            YearOfCompletion: employeeRow.YearOfCompletion,
            PercentageMarks: employeeRow.PercentageMarks
        });
        res.status(200).send({
            status: 'success',
            data: {
                employee: employeeRow
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// PUT API: Update an employee by ROWID
app.put('/employees/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const {
            employeeCode, employeeName, personalEmail, phone, dateOfJoining, dateOfExit, overallExperience,
            relevantExperience, sourceOfHire, pfNo, esicNo, pfStatus, esiStatus, location, gradeLevel, uanNo, dateOfBirth,
            fathersName, age, emergencyContactNumber, emergencyContactName, emergencyContactAddress, emergencyCity, emergencyState, emergencyPostalCode, spouse, gender, bloodGroup, maritalStatus,
            presentAddressLine1, presentAddressLine2, presentCity, presentState, presentPostalCode,
            presentCountry, permanentAddressLine1, permanentAddressLine2, permanentCity,
            permanentState, permanentPostalCode, permanentCountry,
            actualBasic, actualHRA, actualSpecialAllowance, actualDA, attendanceAllowance, otherAllowance, travelChargers, foodAllowance, uniformAllowance, totalSalary,
            revisedActualBasic, revisedActualHRA, revisedActualDA, revisedOtherAllowance, revisedTotalSalary, monthData, dateData,
            aadhaarNumber, panNumber, employeeStatus, department, designation, contractor,
            employmentType, category,
            secondaryContactNumber,
            drivingLicenseNumber, drivingLicenseExpiryDate,
            bankHolderName, bankName, accountNumber, ifscCode, bankBranch,
            qualification, institutionName, fieldOfStudy, yearOfCompletion, percentageMarks,
            educationDetails, // Array of education details
            // File-related fields
            photoFileId, photoFileName,
            aadharCopyFileId, aadharCopyFileName,
            drivingLicenceFileId, drivingLicenceFileName,
            pFEpassbookFileId, pFEpassbookFileName,
            educationalCertificatesFileId, educationalCertificatesFileName,
            bankPassbookFileId, bankPassbookFileName,
            experienceCertificateFileId, experienceCertificateFileName,
            pANCardFileId, pANCardFileName,
            resumeFileId, resumeFileName
        } = req.body;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Employee');

        // Validate mandatory fields
        if (!employeeCode || !employeeName) {
            return res.status(400).send({
                status: 'failure',
                message: 'Employee Code and Name are required.'
            });
        }

        // Helper function to parse numeric fields
        const parseNumeric = (value) => {
            if (value == null) return null;
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                if (value.trim() === '') return null;
                const parsed = parseInt(value.trim(), 10);
                return isNaN(parsed) ? null : parsed;
            }
            // For any other type, try to convert to string and parse
            const strValue = String(value).trim();
            if (strValue === '') return null;
            const parsed = parseInt(strValue, 10);
            return isNaN(parsed) ? null : parsed;
        };

        const userManagement = catalyst.userManagement();
        const userProfile = await userManagement.getCurrentUser();
        const userEmail = userProfile?.email_id || null;
        const userRole = req.query.userRole; // Get user role from query params

        // Fetch existing employee to get Added_User and track old code/name for payroll sync
        const zcql = catalyst.zcql();
        const queryResult = await zcql.executeZCQLQuery(`SELECT Added_User, EmployeeCode, EmployeeName FROM Employee WHERE ROWID = '${ROWID}'`);
        const existingEmployee = queryResult[0]?.Employee || {};
        const oldEmployeeCode = (existingEmployee.EmployeeCode || '').trim();
        const oldEmployeeName = (existingEmployee.EmployeeName || '').trim();

        // Auto-assign contractor name for App Users (same logic as POST endpoint)
        let finalContractorName = contractor;
        if (userRole === 'App User' && userEmail) {
            let assignedContractorName = null;
            
            // Use the same logic as in the GET endpoint to find contractor name
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                assignedContractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                assignedContractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                assignedContractorName = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                assignedContractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                assignedContractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        assignedContractorName = contractorQuery[0].Contractors.ContractorName;
                        console.log(`Found contractor for email ${userEmail}: ${assignedContractorName}`);
                    }
                } catch (error) {
                    console.error('Error finding contractor for App User:', error);
                }
            }
            
            if (assignedContractorName) {
                finalContractorName = assignedContractorName;
                console.log(`Auto-assigned contractor for App User ${userEmail}: ${assignedContractorName}`);
            }
        }

        // Debug: Log file-related fields for update
        console.log('Updating employee with file fields:', {
            photoFileId, photoFileName,
            aadharCopyFileId, aadharCopyFileName,
            drivingLicenceFileId, drivingLicenceFileName,
            pFEpassbookFileId, pFEpassbookFileName,
            educationalCertificatesFileId, educationalCertificatesFileName,
            bankPassbookFileId, bankPassbookFileName,
            experienceCertificateFileId, experienceCertificateFileName,
            pANCardFileId, pANCardFileName,
            resumeFileId, resumeFileName
        });
        
        // Debug: Log emergency contact fields being updated (PUT)
        console.log('PUT - Emergency contact fields received:', {
            emergencyContactName: emergencyContactName,
            emergencyContactAddress: emergencyContactAddress,
            emergencyCity: emergencyCity,
            emergencyState: emergencyState,
            emergencyPostalCode: emergencyPostalCode,
            spouse: spouse
        });

        // Update employee row (add DateofExit)
        const updatedRow = await table.updateRow({
            ROWID,
            EmployeeCode: employeeCode,
            EmployeeName: employeeName,
            Personalemailaddress: personalEmail,
            Phone: parseNumeric(phone),
            DateofJoining: dateOfJoining || null,
            DateofExit: dateOfExit || null, // <-- Added here
            OverallExperience: overallExperience || null,
            RelevantExperience: relevantExperience || null,
            SourceofHire: sourceOfHire || null,
            PFNo: pfNo || null,
            ESICNo: parseNumeric(esicNo),
            PFStatus: pfStatus || null,
            ESIStatus: esiStatus || null,
            Location: location || null,
            GradeLevel: gradeLevel || null,
            UANNo: uanNo || null,
            DateofBirth: dateOfBirth || null,
            FathersName: fathersName || null,
            Age: parseNumeric(age),
            EmergencyContactNumber: parseNumeric(emergencyContactNumber),
            EmergencyContactName: emergencyContactName || null,
            EmergencyContactAddress: emergencyContactAddress || null,
            EmergencyCity: emergencyCity || null,
            EmergencyState: emergencyState || null,
            EmergencyPostalCode: emergencyPostalCode || null,
            Spouse: spouse || null,
            Gender: gender || null,
            BloodGroup: bloodGroup || null,
            MaritalStatus: maritalStatus || null,
            PresentAddressLine1: presentAddressLine1 || null,
            PresentAddressLine2: presentAddressLine2 || null,
            PresentCity: presentCity || null,
            PresentState: presentState || null,
            PresentPostalCode: presentPostalCode || null,
            PresentCountry: presentCountry || null,
            PermanentAddressLine1: permanentAddressLine1 || null,
            PermanentAddressLine2: permanentAddressLine2 || null,
            PermanentCity: permanentCity || null,
            PermanentState: permanentState || null,
            PermanentPostalCode: permanentPostalCode || null,
            PermanentCountry: permanentCountry || null,
            ActualBasic: actualBasic != null && actualBasic !== '' ? actualBasic : null,
            ActualHRA: actualHRA != null && actualHRA !== '' ? actualHRA : null,
            ActualSpecialAllowance: actualSpecialAllowance != null && actualSpecialAllowance !== '' ? actualSpecialAllowance : null,
            SpecialAllowance: actualSpecialAllowance != null && actualSpecialAllowance !== '' ? actualSpecialAllowance : null,
            ActualDA: actualDA != null && actualDA !== '' ? actualDA : null,
            AttendanceAllowance: attendanceAllowance != null && attendanceAllowance !== '' ? attendanceAllowance : null,
            OtherAllowance: otherAllowance != null && otherAllowance !== '' ? otherAllowance : null,
            TravelChargers: travelChargers != null && travelChargers !== '' ? travelChargers : null,
            FoodAllowance: foodAllowance != null && foodAllowance !== '' ? foodAllowance : null,
            UniformAllowance: uniformAllowance != null && uniformAllowance !== '' ? uniformAllowance : null,
            TotalSalary: totalSalary != null && totalSalary !== '' ? totalSalary : null,
            RevisedActualBasic: revisedActualBasic != null && revisedActualBasic !== '' ? revisedActualBasic : null,
            RevisedActualHRA: revisedActualHRA != null && revisedActualHRA !== '' ? revisedActualHRA : null,
            RevisedActualDA: revisedActualDA != null && revisedActualDA !== '' ? revisedActualDA : null,
            RevisedOtherAllowance: revisedOtherAllowance != null && revisedOtherAllowance !== '' ? revisedOtherAllowance : null,
            RevisedTotalSalary: revisedTotalSalary != null && revisedTotalSalary !== '' ? revisedTotalSalary : null,
            aadhaarNumber: aadhaarNumber || null,
            panNumber: panNumber || null,
            employeeStatus: employeeStatus || null,
            Department: (department && String(department).trim()) ? String(department).trim().toUpperCase() : (department || null),
            Designation: (designation && String(designation).trim()) ? String(designation).trim().toUpperCase() : (designation || null),
            EmploymentType: employmentType || null,
            ContractorName: finalContractorName || null,
            Category: (category && String(category).trim()) ? String(category).trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : (category || null),
            SecondaryContactNumber: secondaryContactNumber || null,
            DrivingLicenseNumber: drivingLicenseNumber || null,
            DrivingLicenseExpiryDate: drivingLicenseExpiryDate || null,
            BankHolderName: bankHolderName || null,
            BankName: bankName || null,
            AccountNumber: accountNumber || null,
            IFSCCode: ifscCode || null,
            BankBranch: bankBranch || null,
            // Save first education entry to Employee table columns
            Qualification: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].qualification || null) 
                : (qualification || null),
            InstitutionName: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].institutionName || null) 
                : (institutionName || null),
            FieldOfStudy: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].fieldOfStudy || null) 
                : (fieldOfStudy || null),
            YearOfCompletion: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].yearOfCompletion || null) 
                : (yearOfCompletion || null),
            PercentageMarks: (educationDetails && Array.isArray(educationDetails) && educationDetails.length > 0 && educationDetails[0]) 
                ? (educationDetails[0].percentageMarks || null) 
                : (percentageMarks || null),
            // File-related fields
            PhotoFileId: photoFileId || null,
            PhotoFileName: photoFileName || null,
            AadharCopyFileId: aadharCopyFileId || null,
            AadharCopyFileName: aadharCopyFileName || null,
            PFEpassbookFileId: pFEpassbookFileId || null,
            PFEpassbookFileName: pFEpassbookFileName || null,
            EducationalCertificatesFileId: educationalCertificatesFileId || null,
            EducationalCertificatesFileName: educationalCertificatesFileName || null,
            BankPassbookFileId: bankPassbookFileId || null,
            BankPassbookFileName: bankPassbookFileName || null,
            ExperienceCertificateFileId: experienceCertificateFileId || null,
            ExperienceCertificateFileName: experienceCertificateFileName || null,
            PANCardFileId: pANCardFileId || null,
            PANCardFileName: pANCardFileName || null,
            ResumeFileId: resumeFileId || null,
            ResumeFileName: resumeFileName || null,
            Added_User: existingEmployee.Added_User,
            Modified_User: userEmail,
            MonthData: monthData || null,
            DateData: dateData || null
        });
        
        // Update education details - try JSON first, then EmployeeEducation table, then individual columns
        console.log('PUT - Education details received:', JSON.stringify(educationDetails));
        if (educationDetails !== undefined) {
            const zcql = catalyst.zcql();
            
            // Filter out empty entries
            const validEducationDetails = educationDetails && Array.isArray(educationDetails) 
                ? educationDetails.filter(edu => 
                    edu && (edu.qualification || edu.institutionName || edu.fieldOfStudy || edu.yearOfCompletion || edu.percentageMarks)
                  )
                : [];
            
            console.log(`PUT - Processing ${validEducationDetails.length} education entries for update`);
            
            // Strategy 1: Try to save ALL entries as JSON in EducationDetailsJSON column (preferred method)
            try {
                await table.updateRow({
                    ROWID: ROWID,
                    EducationDetailsJSON: validEducationDetails.length > 0 ? JSON.stringify(validEducationDetails) : null
                });
                console.log(`Successfully saved all ${validEducationDetails.length} education entries as JSON in EducationDetailsJSON column`);
            } catch (jsonErr) {
                console.log('EducationDetailsJSON column not available, trying EmployeeEducation table:', jsonErr.message);
                
                // Strategy 2: If JSON column doesn't exist, try to use EmployeeEducation table
                try {
                    const educationTable = catalyst.datastore().table('EmployeeEducation');
                    
                    // Delete existing education records for this employee
                    try {
                        const existingEduQuery = await zcql.executeZCQLQuery(
                            `SELECT ROWID FROM EmployeeEducation WHERE EmployeeID = '${ROWID}'`
                        );
                        console.log(`Found ${existingEduQuery.length} existing education records to delete`);
                        for (const eduRow of existingEduQuery) {
                            if (eduRow.EmployeeEducation && eduRow.EmployeeEducation.ROWID) {
                                await educationTable.deleteRow(eduRow.EmployeeEducation.ROWID);
                            }
                        }
                        console.log('Deleted existing education records');
                    } catch (deleteErr) {
                        console.error('Error deleting existing education records:', deleteErr);
                        // Continue even if delete fails
                    }
                    
                    // Insert additional education details (first entry already saved to Employee table columns above)
                    // Skip first entry as it's already saved to Employee table
                    const additionalEducationDetails = validEducationDetails.slice(1);
                    if (additionalEducationDetails.length > 0) {
                        console.log(`Processing ${additionalEducationDetails.length} additional education entries for update (first entry saved to Employee table columns)`);
                        let savedCount = 0;
                        for (const edu of additionalEducationDetails) {
                            try {
                                const eduData = {
                                    EmployeeID: ROWID,
                                    Qualification: edu.qualification || null,
                                    InstitutionName: edu.institutionName || null,
                                    FieldOfStudy: edu.fieldOfStudy || null,
                                    YearOfCompletion: edu.yearOfCompletion || null,
                                    PercentageMarks: edu.percentageMarks || null
                                };
                                console.log('Saving additional education entry:', JSON.stringify(eduData));
                                await educationTable.insertRow(eduData);
                                savedCount++;
                                console.log(`Successfully saved additional education entry ${savedCount}`);
                            } catch (eduErr) {
                                console.error('Error saving additional education detail:', eduErr);
                                console.error('Education data that failed:', JSON.stringify(edu));
                                // Continue with other education entries even if one fails
                            }
                        }
                        console.log(`Total additional education entries saved: ${savedCount} out of ${additionalEducationDetails.length}`);
                    } else {
                        console.log('Only one education entry provided, saved to Employee table columns');
                    }
                } catch (tableErr) {
                    console.log('EmployeeEducation table not available:', tableErr.message);
                    console.log('Note: Only the first education entry is saved in Employee table columns. To store multiple entries, please add the "EducationDetailsJSON" column (Long Text/String) to the Employee table in Zoho Catalyst.');
                }
            }
        } else {
            console.log('educationDetails is undefined, skipping update');
        }
        
        // After updating Employee, if name/code changed, update all Payroll rows across all months
        try {
            const newEmployeeCode = (employeeCode || '').trim();
            const newEmployeeName = (employeeName || '').trim();
            const codeChanged = oldEmployeeCode && newEmployeeCode && oldEmployeeCode !== newEmployeeCode;
            const nameChanged = oldEmployeeName !== newEmployeeName;
            
            if (codeChanged || nameChanged) {
                const payrollTable = catalyst.datastore().table('Payroll');
                // Build selector based on whether code changed
                let selectorCode = '';
                if (codeChanged) {
                    // Select by old code to migrate all historical rows
                    const escOld = oldEmployeeCode.replace(/'/g, "''");
                    selectorCode = escOld;
                } else {
                    // Only name changed; select by current/new code
                    const escNew = newEmployeeCode.replace(/'/g, "''");
                    selectorCode = escNew;
                }
                
                const payrollRows = await zcql.executeZCQLQuery(`SELECT ROWID FROM Payroll WHERE EmployeeCode = '${selectorCode}'`);
                let updatedCount = 0;
                for (const pr of payrollRows) {
                    const rid = pr?.Payroll?.ROWID;
                    if (!rid) continue;
                    const updatePayload = {
                        ROWID: rid
                    };
                    if (codeChanged) {
                        updatePayload.EmployeeCode = newEmployeeCode;
                    }
                    if (nameChanged) {
                        updatePayload.EmployeeName = newEmployeeName;
                    }
                    await payrollTable.updateRow(updatePayload);
                    updatedCount++;
                }
                console.log(`Payroll sync completed. Updated ${updatedCount} rows for EmployeeCode change=${codeChanged}, name change=${nameChanged}.`);
            }
        } catch (syncErr) {
            console.error('Error syncing Payroll after Employee update:', syncErr);
            // Continue response even if payroll sync fails
        }

        // Fetch the full employee row after update to verify education details were saved
        const employeeRow = await table.getRow(ROWID);
        console.log('PUT - Employee row after update - Education fields:', {
            Qualification: employeeRow.Qualification,
            InstitutionName: employeeRow.InstitutionName,
            FieldOfStudy: employeeRow.FieldOfStudy,
            YearOfCompletion: employeeRow.YearOfCompletion,
            PercentageMarks: employeeRow.PercentageMarks
        });
        res.status(200).send({
            status: 'success',
            data: {
                employee: employeeRow
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});
// DELETE API: Delete an employee by ROWID
app.delete('/employees/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Employee');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: {
                employee: {
                    id: ROWID
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });

    }
});

// Mapping of document types to Catalyst File Store folder IDs
const DOC_TYPE_TO_FOLDER_ID = {
    Passport: '21320000000042810',
    Resume: '21320000000042782',
    PANCard: '21320000000042763',
    ExperienceCertificate: '21320000000042735',
    BankPassbook: '21320000000042707',
    EducationalCertificates: '21320000000042688',
    PFEpassbook: '21320000000042660',
    OfferLetter: '21320000000042613',
    PaySlip: '21320000000042585',
    Photo: '21320000000042529',
    AadharCopy: '21320000000042510' // Updated to correct folder ID
};

// Helper to get file columns for a docType
function getFileColumns(docType) {
    return {
        fileIdCol: `${docType}FileId`,
        fileNameCol: `${docType}FileName`
    };
}

// Upload file for new employee (before creation)
app.post('/employees/upload/:docType', async (req, res) => {
    try {
        const { docType } = req.params;
        console.log('New employee file upload request for docType:', docType);
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

            // --- Debug logging for Photo uploads ---
            if (docType === 'Photo') {
                console.log('Photo upload response (new employee):', uploadResp);
            }

            // Defensive: handle different possible response structures
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
                console.error('Unexpected upload response (new employee):', uploadResp);
                return res.status(500).send({ status: 'failure', message: 'File upload failed or invalid response from Catalyst.' });
            }

            // --- Debug logging for Photo fileId ---
            if (docType === 'Photo') {
                console.log('Photo fileId to be saved (new employee):', fileId);
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
        console.log('Upload error (new employee):', err);
        res.status(500).send({ status: 'failure', message: err.message || 'File upload failed.' });
    }
});

// Upload file for existing employee and docType
app.post('/employees/:id/upload/:docType', async (req, res) => {
    try {
        const { id, docType } = req.params;
        console.log('Existing employee file upload request for id:', id, 'docType:', docType);
        const { catalyst } = res.locals;
        const folderId = DOC_TYPE_TO_FOLDER_ID[docType];
        console.log('Folder ID for docType:', docType, 'is:', folderId);
        if (!folderId) {
            console.error('Invalid document type:', docType);
            return res.status(400).send({ status: 'failure', message: 'Invalid document type.' });
        }
        if (!req.files || !req.files.file) {
            console.error('No file uploaded for employee id:', id, 'docType:', docType);
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

            // --- Debug logging for Photo uploads ---
            if (docType === 'Photo') {
                console.log('Photo upload response:', uploadResp);
            }

            // Defensive: handle different possible response structures
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
                console.error('Unexpected upload response:', uploadResp);
                return res.status(500).send({ status: 'failure', message: 'File upload failed or invalid response from Catalyst.' });
            }

            // --- Debug logging for Photo fileId ---
            if (docType === 'Photo') {
                console.log('Photo fileId to be saved:', fileId);
            }

            const { fileIdCol, fileNameCol } = getFileColumns(docType);
            // Update Employee row
            const table = catalyst.datastore().table('Employee');
            await table.updateRow({
                ROWID: id,
                [fileIdCol]: fileId,
                [fileNameCol]: fileName
            });
            res.status(200).send({ status: 'success', fileId, fileName });
        } catch (uploadErr) {
            // Clean up temporary file in case of error
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            throw uploadErr;
        }
    } catch (err) {
        console.log(err);
        res.status(500).send({ status: 'failure', message: err.message || 'File upload failed.' });
    }
});

// Download file for employee and docType
app.get('/employees/:id/file/:docType', async (req, res) => {
    try {
        const { id, docType } = req.params;
        console.log('Download request:', { id, docType });
        const { catalyst } = res.locals;
        const folderId = DOC_TYPE_TO_FOLDER_ID[docType];
        console.log('Folder ID for docType:', docType, 'is:', folderId);
        if (!folderId) {
            console.error('Invalid document type:', docType);
            return res.status(400).send({ status: 'failure', message: 'Invalid document type.' });
        }
        const table = catalyst.datastore().table('Employee');
        const employee = await table.getRow(id);
        const { fileIdCol, fileNameCol } = getFileColumns(docType);
        const fileId = employee[fileIdCol];
        const fileName = employee[fileNameCol] || 'downloaded_file';
        console.log('File info:', { fileId, fileName, fileIdCol, fileNameCol });
        if (!fileId) {
            console.error('No file ID found for employee:', id, 'docType:', docType);
            return res.status(404).send({ status: 'failure', message: 'File not found for this employee.' });
        }
        const fileBuffer = await catalyst.filestore().folder(folderId).downloadFile(fileId);
       
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
                'txt': 'text/plain'
            };
            return contentTypes[ext] || 'application/octet-stream';
        };
       
        const contentType = getContentType(fileName);
       
        console.log('Sending file:', { fileName, contentType, fileSize: fileBuffer.length });
        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': fileBuffer.length,
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });
        res.end(fileBuffer);
        console.log('File download completed for:', fileName);
    } catch (err) {
        console.log(err);
        res.status(500).send({ status: 'failure', message: err.message || 'File download failed.' });
    }
});

// Delete file for employee and docType
app.delete('/employees/:id/file/:docType', async (req, res) => {
    try {
        const { id, docType } = req.params;
        const { catalyst } = res.locals;
        const folderId = DOC_TYPE_TO_FOLDER_ID[docType];
        if (!folderId) {
            return res.status(400).send({ status: 'failure', message: 'Invalid document type.' });
        }
        const table = catalyst.datastore().table('Employee');
        const employee = await table.getRow(id);
        const { fileIdCol, fileNameCol } = getFileColumns(docType);
        const fileId = employee[fileIdCol];
        if (!fileId) {
            return res.status(404).send({ status: 'failure', message: 'File not found for this employee.' });
        }
        await catalyst.filestore().folder(folderId).deleteFile(fileId);
        // Clear file columns
        await table.updateRow({
            ROWID: id,
            [fileIdCol]: null,
            [fileNameCol]: null
        });
        res.status(200).send({ status: 'success' });
    } catch (err) {
        console.log(err);
        res.status(500).send({ status: 'failure', message: err.message || 'File delete failed.' });
    }
});

// Add EmployeeEducation endpoints:
// POST /employee-education
app.post('/employee-education', async (req, res) => {
  try {
    const { EmployeeID, Qualification, InstitutionName, FieldOfStudy, YearOfCompletion, PercentageMarks } = req.body;
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('EmployeeEducation');
    const { ROWID: id } = await table.insertRow({
      EmployeeID,
      Qualification,
      InstitutionName,
      FieldOfStudy,
      YearOfCompletion,
      PercentageMarks
    });
    res.status(200).send({ status: 'success', data: { id } });
  } catch (err) {
    res.status(400).send({ status: 'failure', message: err.message || 'Failed to add education record.' });
  }
});
// GET /employee-education/:employeeId
app.get('/employee-education/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { catalyst } = res.locals;
    const zcql = catalyst.zcql();
    const result = await zcql.executeZCQLQuery(
      `SELECT * FROM EmployeeEducation WHERE EmployeeID = '${employeeId}'`
    );
    const rows = result.map(r => r.EmployeeEducation);
    res.status(200).send({ status: 'success', data: rows });
  } catch (err) {
    res.status(400).send({ status: 'failure', message: err.message || 'Failed to fetch education records.' });
  }
});
// PUT /employee-education/:id
app.put('/employee-education/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { Qualification, InstitutionName, FieldOfStudy, YearOfCompletion, PercentageMarks } = req.body;
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('EmployeeEducation');
    await table.updateRow({
      ROWID: id,
      Qualification,
      InstitutionName,
      FieldOfStudy,
      YearOfCompletion,
      PercentageMarks
    });
    res.status(200).send({ status: 'success' });
  } catch (err) {
    res.status(400).send({ status: 'failure', message: err.message || 'Failed to update education record.' });
  }
});
// DELETE /employee-education/:id
app.delete('/employee-education/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('EmployeeEducation');
    await table.deleteRow(id);
    res.status(200).send({ status: 'success' });
  } catch (err) {
    res.status(400).send({ status: 'failure', message: err.message || 'Failed to delete education record.' });
  }
});

// Utility endpoint: Check which columns exist in Employee table
app.get('/employees/check-columns', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
       
        // Get one employee record with all columns to see what exists
        const query = `SELECT * FROM Employee LIMIT 1`;
        const result = await zcql.executeZCQLQuery(query);
       
        if (result.length === 0) {
            return res.json({
                status: 'success',
                data: {
                    message: 'No employees found',
                    availableColumns: []
                }
            });
        }
       
        const availableColumns = Object.keys(result[0].Employee || {});
        const newColumns = [
            'EmergencyContactName',
            'EmergencyContactAddress',
            'EmergencyCity',
            'EmergencyState',
            'EmergencyPostalCode',
            'Spouse',
            'BankHolderName',
            'BankName',
            'AccountNumber',
            'IFSCCode',
            'BankBranch'
        ];
       
        const columnStatus = {};
        newColumns.forEach(col => {
            columnStatus[col] = availableColumns.includes(col);
        });
       
        res.json({
            status: 'success',
            data: {
                totalColumns: availableColumns.length,
                availableColumns: availableColumns.sort(),
                newColumnsStatus: columnStatus,
                sampleEmployee: result[0].Employee
            }
        });
    } catch (error) {
        console.error('Error checking columns:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error checking columns',
            error: error.message
        });
    }
});

// Utility endpoint: Get all employees with their contractor names (for debugging)
app.get('/employees/debug', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
       
        // Get all employees with contractor names
        const query = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ORDER BY ContractorName, EmployeeName`;
        const result = await zcql.executeZCQLQuery(query);
       
        // Group by contractor
        const contractors = {};
        result.forEach(row => {
            const contractor = row.Employee.ContractorName || 'No Contractor';
            if (!contractors[contractor]) {
                contractors[contractor] = [];
            }
            contractors[contractor].push({
                id: row.Employee.ROWID,
                name: row.Employee.EmployeeName,
                code: row.Employee.EmployeeCode
            });
        });
       
        res.json({
            status: 'success',
            data: {
                contractors,
                totalEmployees: result.length,
                contractorCount: Object.keys(contractors).length
            }
        });
    } catch (error) {
        console.error('Error fetching employee debug info:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error fetching employee debug info'
        });
    }
});

// Utility endpoint: Update employees to change their contractor
app.post('/employees/update-contractor', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { employeeIds, newContractorName } = req.body;
       
        if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
            return res.status(400).json({
                status: 'failure',
                message: 'employeeIds array is required'
            });
        }
       
        if (!newContractorName) {
            return res.status(400).json({
                status: 'failure',
                message: 'newContractorName is required'
            });
        }
       
        const table = catalyst.datastore().table('Employee');
        const updatedEmployees = [];
       
        for (const employeeId of employeeIds) {
            try {
                const updatedRow = await table.updateRow({
                    ROWID: employeeId,
                    ContractorName: newContractorName
                });
                updatedEmployees.push({
                    id: employeeId,
                    name: updatedRow.EmployeeName,
                    contractor: newContractorName
                });
            } catch (error) {
                console.error(`Error updating employee ${employeeId}:`, error);
            }
        }
       
        res.json({
            status: 'success',
            message: `Updated ${updatedEmployees.length} employees to contractor: ${newContractorName}`,
            data: {
                updatedEmployees,
                newContractorName
            }
        });
    } catch (error) {
        console.error('Error updating contractor for employees:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error updating contractor for employees'
        });
    }
});


// Debug endpoint: Check employees with specific contractor name
app.get('/employees/debug-contractor/:contractorName', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { contractorName } = req.params;
        const zcql = catalyst.zcql();
       
        console.log(`Debug: Checking employees for contractor: ${contractorName}`);
       
        // Query all employees with this contractor name
        const query = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${contractorName}'`;
        console.log(`Debug query: ${query}`);
       
        const result = await zcql.executeZCQLQuery(query);
        console.log(`Debug result:`, result);
       
        res.json({
            status: 'success',
            data: {
                contractorName,
                query,
                employees: result.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                count: result.length
            }
        });
    } catch (error) {
        console.error('Error in debug contractor endpoint:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error checking contractor employees',
            error: error.message
        });
    }
});


// Simple endpoint: Create basic employees for Samuel Enterprise
app.post('/employees/create-basic-samuel-enterprise', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
       
        console.log('Creating basic employees for Samuel Enterprise');
       
        // Simple employee data for Samuel Enterprise
        const basicEmployees = [
            {
                EmployeeCode: 'SE001',
                EmployeeName: 'John Smith',
                Personalemailaddress: 'john.smith@samuelenterprise.com',
                Phone: '9876543210',
                DateofJoining: '2024-01-15',
                DateofBirth: '1990-05-15',
                FathersName: 'Robert Smith',
                Age: 34,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '123 Business Street, Mumbai',
                PresentState: 'Maharashtra',
                PresentCountry: 'India',
                ContractorName: 'Samuel Enterprise',
                Department: 'Operations',
                Designation: 'Manager',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789015',
                Added_User: 'afrinatlin@gmail.com',
                Modified_User: 'afrinatlin@gmail.com'
            },
            {
                EmployeeCode: 'SE002',
                EmployeeName: 'Sarah Johnson',
                Personalemailaddress: 'sarah.johnson@samuelenterprise.com',
                Phone: '9876543211',
                DateofJoining: '2024-02-01',
                DateofBirth: '1992-08-20',
                FathersName: 'Michael Johnson',
                Age: 32,
                Gender: 'Female',
                MaritalStatus: 'Unmarried',
                PresentAddressLine1: '456 Corporate Avenue, Mumbai',
                PresentState: 'Maharashtra',
                PresentCountry: 'India',
                ContractorName: 'Samuel Enterprise',
                Department: 'Finance',
                Designation: 'Accountant',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789016',
                Added_User: 'afrinatlin@gmail.com',
                Modified_User: 'afrinatlin@gmail.com'
            },
            {
                EmployeeCode: 'SE003',
                EmployeeName: 'David Wilson',
                Personalemailaddress: 'david.wilson@samuelenterprise.com',
                Phone: '9876543212',
                DateofJoining: '2024-03-10',
                DateofBirth: '1988-12-10',
                FathersName: 'James Wilson',
                Age: 36,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '789 Industrial Zone, Mumbai',
                PresentState: 'Maharashtra',
                PresentCountry: 'India',
                ContractorName: 'Samuel Enterprise',
                Department: 'Production',
                Designation: 'Supervisor',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789017',
                Added_User: 'afrinatlin@gmail.com',
                Modified_User: 'afrinatlin@gmail.com'
            }
        ];
       
        const createdEmployees = [];
       
        for (const employee of basicEmployees) {
            try {
                // Simple INSERT query
                const insertQuery = `INSERT INTO Employee (EmployeeCode, EmployeeName, Personalemailaddress, Phone, DateofJoining, DateofBirth, FathersName, Age, Gender, MaritalStatus, PresentAddressLine1, PresentState, PresentCountry, ContractorName, Department, Designation, employeeStatus, aadhaarNumber, Added_User, Modified_User) VALUES ('${employee.EmployeeCode}', '${employee.EmployeeName}', '${employee.Personalemailaddress}', '${employee.Phone}', '${employee.DateofJoining}', '${employee.DateofBirth}', '${employee.FathersName}', ${employee.Age}, '${employee.Gender}', '${employee.MaritalStatus}', '${employee.PresentAddressLine1}', '${employee.PresentState}', '${employee.PresentCountry}', '${employee.ContractorName}', '${employee.Department}', '${employee.Designation}', '${employee.employeeStatus}', '${employee.aadhaarNumber}', '${employee.Added_User}', '${employee.Modified_User}')`;
               
                console.log(`Creating employee: ${employee.EmployeeName}`);
                await zcql.executeZCQLQuery(insertQuery);
               
                createdEmployees.push({
                    name: employee.EmployeeName,
                    code: employee.EmployeeCode,
                    contractor: employee.ContractorName
                });
                console.log(`Created employee: ${employee.EmployeeName}`);
            } catch (error) {
                console.error(`Error creating employee ${employee.EmployeeName}:`, error);
            }
        }
       
        res.json({
            status: 'success',
            message: `Created ${createdEmployees.length} basic employees for Samuel Enterprise`,
            data: {
                createdEmployees,
                contractorName: 'Samuel Enterprise'
            }
        });
    } catch (error) {
        console.error('Error creating basic employees:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error creating basic employees'
        });
    }
});

// Simple endpoint: Create basic employees for Sriram Enterprise
app.post('/employees/create-basic-sriram-enterprise', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const table = catalyst.datastore().table('Employee');
       
        console.log('Creating basic employees for Sriram Enterprise');
       
        // Simple employee data for Sriram Enterprise
        const basicEmployees = [
            {
                EmployeeCode: 'SRE001',
                EmployeeName: 'Kumar Rajesh',
                Personalemailaddress: 'kumar.rajesh@sriramenterprise.com',
                Phone: '9876543210',
                DateofJoining: '2024-01-15',
                DateofBirth: '1990-05-15',
                FathersName: 'Suresh Kumar',
                Age: 34,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '123 Main Street, Bangalore',
                PresentState: 'Karnataka',
                PresentCountry: 'India',
                ContractorName: 'Sriram Enterprise',
                Department: 'Production',
                Designation: 'Supervisor',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789018',
                Added_User: 'afrindinusha.j@buildhr.co.in',
                Modified_User: 'afrindinusha.j@buildhr.co.in'
            },
            {
                EmployeeCode: 'SRE002',
                EmployeeName: 'Priya Singh',
                Personalemailaddress: 'priya.singh@sriramenterprise.com',
                Phone: '9876543211',
                DateofJoining: '2024-02-01',
                DateofBirth: '1992-08-20',
                FathersName: 'Ramesh Singh',
                Age: 32,
                Gender: 'Female',
                MaritalStatus: 'Unmarried',
                PresentAddressLine1: '456 Park Avenue, Bangalore',
                PresentState: 'Karnataka',
                PresentCountry: 'India',
                ContractorName: 'Sriram Enterprise',
                Department: 'Quality Control',
                Designation: 'Quality Inspector',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789019',
                Added_User: 'afrindinusha.j@buildhr.co.in',
                Modified_User: 'afrindinusha.j@buildhr.co.in'
            },
            {
                EmployeeCode: 'SRE003',
                EmployeeName: 'Mohan Patel',
                Personalemailaddress: 'mohan.patel@sriramenterprise.com',
                Phone: '9876543212',
                DateofJoining: '2024-03-10',
                DateofBirth: '1988-12-10',
                FathersName: 'Jagdish Patel',
                Age: 36,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '789 Industrial Area, Bangalore',
                PresentState: 'Karnataka',
                PresentCountry: 'India',
                ContractorName: 'Sriram Enterprise',
                Department: 'Maintenance',
                Designation: 'Technician',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789020',
                Added_User: 'afrindinusha.j@buildhr.co.in',
                Modified_User: 'afrindinusha.j@buildhr.co.in'
            }
        ];
       
        const createdEmployees = [];
       
        for (const employee of basicEmployees) {
            try {
                console.log(`Creating employee: ${employee.EmployeeName}`);
               
                // Use table.insertRow instead of ZCQL INSERT
                const { ROWID: id } = await table.insertRow({
                    EmployeeCode: employee.EmployeeCode,
                    EmployeeName: employee.EmployeeName,
                    Personalemailaddress: employee.Personalemailaddress,
                    Phone: employee.Phone,
                    DateofJoining: employee.DateofJoining,
                    DateofBirth: employee.DateofBirth,
                    FathersName: employee.FathersName,
                    Age: employee.Age,
                    Gender: employee.Gender,
                    MaritalStatus: employee.MaritalStatus,
                    PresentAddressLine1: employee.PresentAddressLine1,
                    PresentState: employee.PresentState,
                    PresentCountry: employee.PresentCountry,
                    ContractorName: employee.ContractorName,
                    Department: employee.Department,
                    Designation: employee.Designation,
                    employeeStatus: employee.employeeStatus,
                    aadhaarNumber: employee.aadhaarNumber,
                    Added_User: employee.Added_User,
                    Modified_User: employee.Modified_User
                });
               
                createdEmployees.push({
                    id: id,
                    name: employee.EmployeeName,
                    code: employee.EmployeeCode,
                    contractor: employee.ContractorName
                });
                console.log(`Created employee: ${employee.EmployeeName} with ID: ${id}`);
            } catch (error) {
                console.error(`Error creating employee ${employee.EmployeeName}:`, error);
            }
        }
       
        res.json({
            status: 'success',
            message: `Created ${createdEmployees.length} basic employees for Sriram Enterprise`,
            data: {
                createdEmployees,
                contractorName: 'Sriram Enterprise'
            }
        });
    } catch (error) {
        console.error('Error creating basic employees:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error creating basic employees'
        });
    }
});


// Debug endpoint: Check Sriram Enterprise employees specifically
app.get('/employees/debug-sriram-enterprise', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
       
        console.log('Debug: Checking employees for Sriram Enterprise');
       
        // Query all employees with Sriram Enterprise contractor name
        const query = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sriram Enterprise'`;
        console.log(`Debug query: ${query}`);
       
        const result = await zcql.executeZCQLQuery(query);
        console.log(`Debug result:`, result);
       
        res.json({
            status: 'success',
            data: {
                contractorName: 'Sriram Enterprise',
                query,
                employees: result.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                count: result.length
            }
        });
    } catch (error) {
        console.error('Error in debug Sriram Enterprise endpoint:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error checking Sriram Enterprise employees',
            error: error.message
        });
    }
});

// Quick test endpoint: Create Sri Balaji Enterprises employees
app.post('/employees/create-sri-balaji-enterprises', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const table = catalyst.datastore().table('Employee');
        
        console.log('=== CREATING EMPLOYEES FOR SRI BALAJI ENTERPRISES ===');
        
        const employees = [
            {
                EmployeeCode: 'SBE001',
                EmployeeName: 'Rajesh Kumar',
                Personalemailaddress: 'rajesh.kumar@sribalaji.com',
                Phone: '9876543210',
                DateofJoining: '2024-01-15',
                DateofBirth: '1990-05-10',
                FathersName: 'Suresh Kumar',
                Age: 34,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '123 Main Street, Chennai',
                PresentState: 'Tamil Nadu',
                PresentCountry: 'India',
                ContractorName: 'Sri Balaji Enterprises',
                Department: 'Production',
                Designation: 'Production Supervisor',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789012',
                Added_User: 'dinushaafrin@gmail.com',
                Modified_User: 'dinushaafrin@gmail.com'
            },
            {
                EmployeeCode: 'SBE002',
                EmployeeName: 'Priya Sharma',
                Personalemailaddress: 'priya.sharma@sribalaji.com',
                Phone: '9876543211',
                DateofJoining: '2024-02-01',
                DateofBirth: '1992-08-20',
                FathersName: 'Ramesh Sharma',
                Age: 32,
                Gender: 'Female',
                MaritalStatus: 'Unmarried',
                PresentAddressLine1: '456 Park Avenue, Chennai',
                PresentState: 'Tamil Nadu',
                PresentCountry: 'India',
                ContractorName: 'Sri Balaji Enterprises',
                Department: 'Quality Control',
                Designation: 'Quality Inspector',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789013',
                Added_User: 'dinushaafrin@gmail.com',
                Modified_User: 'dinushaafrin@gmail.com'
            },
            {
                EmployeeCode: 'SBE003',
                EmployeeName: 'Amit Patel',
                Personalemailaddress: 'amit.patel@sribalaji.com',
                Phone: '9876543212',
                DateofJoining: '2024-03-10',
                DateofBirth: '1988-12-15',
                FathersName: 'Vikram Patel',
                Age: 36,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '789 Industrial Area, Chennai',
                PresentState: 'Tamil Nadu',
                PresentCountry: 'India',
                ContractorName: 'Sri Balaji Enterprises',
                Department: 'Maintenance',
                Designation: 'Maintenance Engineer',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789014',
                Added_User: 'dinushaafrin@gmail.com',
                Modified_User: 'dinushaafrin@gmail.com'
            }
        ];
        
        const createdEmployees = [];
        
        for (const employee of employees) {
            try {
                console.log(`Creating employee: ${employee.EmployeeName}`);
                const { ROWID: id } = await table.insertRow(employee);
                createdEmployees.push({
                    id: id,
                    name: employee.EmployeeName,
                    code: employee.EmployeeCode,
                    contractor: employee.ContractorName
                });
                console.log(`Created employee: ${employee.EmployeeName} with ID: ${id}`);
            } catch (error) {
                console.error(`Error creating employee ${employee.EmployeeName}:`, error);
            }
        }
        
        res.json({
            status: 'success',
            message: `Created ${createdEmployees.length} employees for Sri Balaji Enterprises`,
            data: {
                createdEmployees,
                contractorName: 'Sri Balaji Enterprises'
            }
        });
    } catch (error) {
        console.error('Error creating Sri Balaji Enterprises employees:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error creating employees',
            error: error.message
        });
    }
});

// Quick test endpoint: Create Sriram employees and test filtering
app.post('/employees/quick-test-sriram', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Employee');
        const zcql = catalyst.zcql();
        
        console.log('=== QUICK TEST: Creating Sriram Enterprise employees and testing filtering ===');
        
        // Step 1: Check if employees already exist
        console.log('Step 1: Checking existing Sriram Enterprise employees...');
        const existingQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sriram Enterprise'`;
        const existingResult = await zcql.executeZCQLQuery(existingQuery);
        console.log(`Found ${existingResult.length} existing employees for Sriram Enterprise`);
        
        let createdEmployees = [];
        
        // Step 2: Create employees if none exist
        if (existingResult.length === 0) {
            console.log('Step 2: Creating test employees for Sriram Enterprise...');
            
            const employees = [
                {
                    EmployeeCode: 'SRE001',
                    EmployeeName: 'Kumar Rajesh',
                    Personalemailaddress: 'kumar.rajesh@sriramenterprise.com',
                    Phone: '9876543210',
                    DateofJoining: '2024-01-15',
                    DateofBirth: '1990-05-15',
                    FathersName: 'Suresh Kumar',
                    Age: 34,
                    Gender: 'Male',
                    MaritalStatus: 'Married',
                    PresentAddressLine1: '123 Main Street, Bangalore',
                    PresentState: 'Karnataka',
                    PresentCountry: 'India',
                    ContractorName: 'Sriram Enterprise',
                    Department: 'Production',
                    Designation: 'Supervisor',
                    employeeStatus: 'Active',
                    aadhaarNumber: '123456789018',
                    Added_User: 'afrindinusha.j@buildhr.co.in',
                    Modified_User: 'afrindinusha.j@buildhr.co.in'
                },
                {
                    EmployeeCode: 'SRE002',
                    EmployeeName: 'Priya Singh',
                    Personalemailaddress: 'priya.singh@sriramenterprise.com',
                    Phone: '9876543211',
                    DateofJoining: '2024-02-01',
                    DateofBirth: '1992-08-20',
                    FathersName: 'Ramesh Singh',
                    Age: 32,
                    Gender: 'Female',
                    MaritalStatus: 'Unmarried',
                    PresentAddressLine1: '456 Park Avenue, Bangalore',
                    PresentState: 'Karnataka',
                    PresentCountry: 'India',
                    ContractorName: 'Sriram Enterprise',
                    Department: 'Quality Control',
                    Designation: 'Quality Inspector',
                    employeeStatus: 'Active',
                    aadhaarNumber: '123456789019',
                    Added_User: 'afrindinusha.j@buildhr.co.in',
                    Modified_User: 'afrindinusha.j@buildhr.co.in'
                }
            ];
            
            for (const employee of employees) {
                try {
                    console.log(`Creating employee: ${employee.EmployeeName}`);
                    const { ROWID: id } = await table.insertRow(employee);
                    createdEmployees.push({
                        id: id,
                        name: employee.EmployeeName,
                        code: employee.EmployeeCode,
                        contractor: employee.ContractorName
                    });
                    console.log(`Created employee: ${employee.EmployeeName} with ID: ${id}`);
                } catch (error) {
                    console.error(`Error creating employee ${employee.EmployeeName}:`, error);
                }
            }
        } else {
            console.log('Step 2: Using existing employees');
            createdEmployees = existingResult.map(row => ({
                id: row.Employee.ROWID,
                name: row.Employee.EmployeeName,
                code: row.Employee.EmployeeCode,
                contractor: row.Employee.ContractorName
            }));
        }
        
        // Step 3: Test filtering logic
        console.log('Step 3: Testing filtering logic...');
        const userEmail = 'afrindinusha.j@buildhr.co.in';
        const userRole = 'App User';
        
        let contractorName = null;
        if (userEmail === "afrindinusha.j@buildhr.co.in") {
            contractorName = "Sriram Enterprise";
            console.log(`Filtering for contractor: ${contractorName}`);
        }
        
        // Step 4: Test the actual filtering query
        console.log('Step 4: Testing filtering query...');
        const filterQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${contractorName}'`;
        console.log(`Filter query: ${filterQuery}`);
        
        const filterResult = await zcql.executeZCQLQuery(filterQuery);
        console.log(`Filter result: Found ${filterResult.length} employees`);
        
        const filteredEmployees = filterResult.map(row => ({
            id: row.Employee.ROWID,
            name: row.Employee.EmployeeName,
            code: row.Employee.EmployeeCode,
            contractor: row.Employee.ContractorName
        }));
        
        console.log('=== QUICK TEST COMPLETED ===');
        
        res.json({
            status: 'success',
            message: 'Quick test completed',
            data: {
                existingCount: existingResult.length,
                createdCount: createdEmployees.length,
                filteredCount: filteredEmployees.length,
                createdEmployees: createdEmployees,
                filteredEmployees: filteredEmployees,
                testQuery: filterQuery,
                userEmail: userEmail,
                userRole: userRole,
                contractorName: contractorName
            }
        });
        
    } catch (error) {
        console.error('Quick test error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Quick test failed',
            error: error.message
        });
    }
});

// Debug endpoint: Check Samuel Enterprise employees specifically
app.get('/employees/debug-samuel-enterprise', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
       
        console.log('Debug: Checking employees for Samuel Enterprise');
       
        // Query all employees with Samuel Enterprise contractor name
        const query = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Samuel Enterprise'`;
        console.log(`Debug query: ${query}`);
       
        const result = await zcql.executeZCQLQuery(query);
        console.log(`Debug result:`, result);
       
        res.json({
            status: 'success',
            data: {
                contractorName: 'Samuel Enterprise',
                query,
                employees: result.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                count: result.length
            }
        });
    } catch (error) {
        console.error('Error in debug Samuel Enterprise endpoint:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error checking Samuel Enterprise employees',
            error: error.message
        });
    }
});

// Debug endpoint: Check all contractors in the Contractors table
app.get('/contractors/debug-all', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
       
        console.log('Debug: Checking all contractors in Contractors table');
       
        // Query all contractors
        const query = `SELECT ROWID, ContractorName, PrimaryEmail FROM Contractors ORDER BY ContractorName`;
        console.log(`Debug query: ${query}`);
       
        const result = await zcql.executeZCQLQuery(query);
        console.log(`Debug result:`, result);
       
        res.json({
            status: 'success',
            data: {
                query,
                contractors: result.map(row => ({
                    id: row.Contractors.ROWID,
                    name: row.Contractors.ContractorName,
                    email: row.Contractors.PrimaryEmail
                })),
                count: result.length
            }
        });
    } catch (error) {
        console.error('Error in debug contractors endpoint:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error checking contractors',
            error: error.message
        });
    }
});

// Debug endpoint: Check specific contractor by email
app.get('/contractors/debug-by-email/:email', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { email } = req.params;
        const zcql = catalyst.zcql();
       
        console.log(`Debug: Checking contractor for email: ${email}`);
       
        // Query contractor by email
        const query = `SELECT ROWID, ContractorName, PrimaryEmail FROM Contractors WHERE PrimaryEmail = '${email}'`;
        console.log(`Debug query: ${query}`);
       
        const result = await zcql.executeZCQLQuery(query);
        console.log(`Debug result:`, result);
       
        res.json({
            status: 'success',
            data: {
                email,
                query,
                contractor: result.length > 0 ? {
                    id: result[0].Contractors.ROWID,
                    name: result[0].Contractors.ContractorName,
                    email: result[0].Contractors.PrimaryEmail
                } : null,
                found: result.length > 0
            }
        });
    } catch (error) {
        console.error('Error in debug contractor by email endpoint:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error checking contractor by email',
            error: error.message
        });
    }
});

// Utility endpoint: Create contractor record for afrindinusha29@gmail.com
app.post('/contractors/create-sri-balaji', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const table = catalyst.datastore().table('Contractors');
       
        console.log('Creating contractor record for Sri Balaji Enterprises');
       
        // Check if contractor already exists
        const existingQuery = `SELECT ROWID FROM Contractors WHERE PrimaryEmail = 'afrindinusha29@gmail.com'`;
        const existingResult = await zcql.executeZCQLQuery(existingQuery);
       
        if (existingResult.length > 0) {
            return res.json({
                status: 'success',
                message: 'Contractor already exists',
                data: {
                    contractorId: existingResult[0].Contractors.ROWID,
                    contractorName: 'Sriram Enterprises',
                    email: 'afrindinusha29@gmail.com'
                }
            });
        }
       
        // Create new contractor record
        const contractorData = {
            ContractorName: 'Sriram Enterprises',
            PrimaryEmail: 'afrindinusha29@gmail.com',
            ContactPerson: 'Sri Balaji',
            Phone: '9876543210',
            Address: 'Chennai, Tamil Nadu, India',
            Status: 'Active'
        };
       
        const { ROWID: contractorId } = await table.insertRow(contractorData);
       
        console.log(`Created contractor: Sri Balaji Enterprises (ID: ${contractorId})`);
       
        res.json({
            status: 'success',
            message: 'Contractor created successfully',
            data: {
                contractorId,
                contractorName: 'Sri Balaji Enterprises',
                email: 'afrindinusha29@gmail.com'
            }
        });
    } catch (error) {
        console.error('Error creating contractor:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error creating contractor',
            error: error.message
        });
    }
});

// Auto-create contractor record on server startup
app.post('/contractors/auto-create-sri-balaji', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const table = catalyst.datastore().table('Contractors');
       
        console.log('=== AUTO-CREATING CONTRACTOR RECORD FOR SRI BALAJI ENTERPRISES ===');
       
        // Check if contractor already exists
        const existingQuery = `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = 'afrindinusha29@gmail.com'`;
        const existingResult = await zcql.executeZCQLQuery(existingQuery);
       
        if (existingResult.length > 0) {
            console.log('✅ Contractor already exists:', existingResult[0].Contractors.ContractorName);
            return res.json({
                status: 'success',
                message: 'Contractor already exists',
                data: {
                    contractorId: existingResult[0].Contractors.ROWID,
                    contractorName: existingResult[0].Contractors.ContractorName,
                    email: 'afrindinusha29@gmail.com',
                    action: 'already_exists'
                }
            });
        }
       
        // Create new contractor record
        console.log('Creating new contractor record...');
        const contractorData = {
            ContractorName: 'Sriram Enterprises',
            PrimaryEmail: 'afrindinusha29@gmail.com',
            ContactPerson: 'Sri Balaji',
            Phone: '9876543210',
            Address: 'Chennai, Tamil Nadu, India',
            Status: 'Active'
        };
       
        const { ROWID: contractorId } = await table.insertRow(contractorData);
       
        console.log(`✅ Created contractor: Sri Balaji Enterprises (ID: ${contractorId})`);
        console.log('=== CONTRACTOR CREATION COMPLETED ===');
       
        res.json({
            status: 'success',
            message: 'Contractor created successfully',
            data: {
                contractorId,
                contractorName: 'Sri Balaji Enterprises',
                email: 'afrindinusha29@gmail.com',
                action: 'created'
            }
        });
    } catch (error) {
        console.error('❌ Error creating contractor:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error creating contractor',
            error: error.message
        });
    }
});

// Immediate fix endpoint - create employees and test API in one call
app.post('/fix-afrindinu14-employees', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Employee');
        const zcql = catalyst.zcql();
        
        console.log('=== IMMEDIATE FIX FOR afrindinu14@gmail.com ===');
        
        // Step 1: Check current state
        const existingQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Yashaswi Academy for Skills'`;
        const existingResult = await zcql.executeZCQLQuery(existingQuery);
        console.log(`Current employees for Yashaswi Academy for Skills: ${existingResult.length}`);
        
        let createdEmployees = [];
        
        // Step 2: Create employees if none exist
        if (existingResult.length === 0) {
            console.log('Creating test employees for Yashaswi Academy for Skills...');
            
            const employees = [
                {
                    EmployeeCode: 'SBE001',
                    EmployeeName: 'Rajesh Kumar',
                    Personalemailaddress: 'rajesh.kumar@sribalaji.com',
                    Phone: '9876543210',
                    DateofJoining: '2024-01-15',
                    DateofBirth: '1990-05-10',
                    FathersName: 'Suresh Kumar',
                    Age: 34,
                    Gender: 'Male',
                    MaritalStatus: 'Married',
                    PresentAddressLine1: '123 Main Street, Chennai',
                    PresentState: 'Tamil Nadu',
                    PresentCountry: 'India',
                    ContractorName: 'Yashaswi Academy for Skills',
                    Department: 'Production',
                    Designation: 'Production Supervisor',
                    employeeStatus: 'Active',
                    aadhaarNumber: '123456789012',
                    Added_User: 'afrindinu14@gmail.com',
                    Modified_User: 'afrindinu14@gmail.com'
                },
                {
                    EmployeeCode: 'SBE002',
                    EmployeeName: 'Priya Sharma',
                    Personalemailaddress: 'priya.sharma@sribalaji.com',
                    Phone: '9876543211',
                    DateofJoining: '2024-02-01',
                    DateofBirth: '1992-08-20',
                    FathersName: 'Ramesh Sharma',
                    Age: 32,
                    Gender: 'Female',
                    MaritalStatus: 'Unmarried',
                    PresentAddressLine1: '456 Park Avenue, Chennai',
                    PresentState: 'Tamil Nadu',
                    PresentCountry: 'India',
                    ContractorName: 'Yashaswi Academy for Skills',
                    Department: 'Quality Control',
                    Designation: 'Quality Inspector',
                    employeeStatus: 'Active',
                    aadhaarNumber: '123456789013',
                    Added_User: 'afrindinu14@gmail.com',
                    Modified_User: 'afrindinu14@gmail.com'
                },
                {
                    EmployeeCode: 'SBE003',
                    EmployeeName: 'Amit Patel',
                    Personalemailaddress: 'amit.patel@sribalaji.com',
                    Phone: '9876543212',
                    DateofJoining: '2024-03-10',
                    DateofBirth: '1988-12-15',
                    FathersName: 'Vikram Patel',
                    Age: 36,
                    Gender: 'Male',
                    MaritalStatus: 'Married',
                    PresentAddressLine1: '789 Industrial Area, Chennai',
                    PresentState: 'Tamil Nadu',
                    PresentCountry: 'India',
                    ContractorName: 'Yashaswi Academy for Skills',
                    Department: 'Maintenance',
                    Designation: 'Maintenance Engineer',
                    employeeStatus: 'Active',
                    aadhaarNumber: '123456789014',
                    Added_User: 'afrindinu14@gmail.com',
                    Modified_User: 'afrindinu14@gmail.com'
                }
            ];
            
            for (const employee of employees) {
                try {
                    console.log(`Creating employee: ${employee.EmployeeName}`);
                    const { ROWID: id } = await table.insertRow(employee);
                    createdEmployees.push({
                        id: id,
                        name: employee.EmployeeName,
                        code: employee.EmployeeCode,
                        contractor: employee.ContractorName
                    });
                    console.log(`✅ Created employee: ${employee.EmployeeName} with ID: ${id}`);
                } catch (error) {
                    console.error(`❌ Error creating employee ${employee.EmployeeName}:`, error);
                }
            }
        } else {
            console.log('Employees already exist, using existing ones');
            createdEmployees = existingResult.map(row => ({
                id: row.Employee.ROWID,
                name: row.Employee.EmployeeName,
                code: row.Employee.EmployeeCode,
                contractor: row.Employee.ContractorName
            }));
        }
        
        // Step 3: Test the API call immediately after creation
        console.log('Testing API call after employee creation...');
        const testQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sri Balaji Enterprises'`;
        const testResult = await zcql.executeZCQLQuery(testQuery);
        console.log(`API test result: ${testResult.length} employees found`);
        
        res.json({
            status: 'success',
            message: `Fixed employee display for afrindinu14@gmail.com`,
            data: {
                action: existingResult.length === 0 ? 'created_employees' : 'employees_already_existed',
                createdCount: createdEmployees.length,
                employees: createdEmployees,
                apiTestResult: testResult.length,
                nextStep: 'Refresh the Employee Directory page in your browser'
            }
        });
    } catch (error) {
        console.error('❌ Fix error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fix employee display',
            error: error.message
        });
    }
});

// Quick endpoint to create employees for afrindinu14@gmail.com testing
app.post('/employees/create-for-afrindinu14', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Employee');
        const zcql = catalyst.zcql();
        
        console.log('=== CREATING EMPLOYEES FOR afrindinu14@gmail.com TESTING ===');
        
        // First check if employees already exist
        const existingQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sri Balaji Enterprises'`;
        const existingResult = await zcql.executeZCQLQuery(existingQuery);
        console.log(`Found ${existingResult.length} existing employees for Sri Balaji Enterprises`);
        
        if (existingResult.length > 0) {
            return res.json({
                status: 'success',
                message: 'Employees already exist for Sri Balaji Enterprises',
                data: {
                    existingEmployees: existingResult.map(row => ({
                        id: row.Employee.ROWID,
                        name: row.Employee.EmployeeName,
                        code: row.Employee.EmployeeCode,
                        contractor: row.Employee.ContractorName
                    })),
                    count: existingResult.length
                }
            });
        }
        
        // Create test employees for Sri Balaji Enterprises
        const employees = [
            {
                EmployeeCode: 'SBE001',
                EmployeeName: 'Rajesh Kumar',
                Personalemailaddress: 'rajesh.kumar@sribalaji.com',
                Phone: '9876543210',
                DateofJoining: '2024-01-15',
                DateofBirth: '1990-05-10',
                FathersName: 'Suresh Kumar',
                Age: 34,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '123 Main Street, Chennai',
                PresentState: 'Tamil Nadu',
                PresentCountry: 'India',
                ContractorName: 'Sri Balaji Enterprises',
                Department: 'Production',
                Designation: 'Production Supervisor',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789012',
                Added_User: 'afrindinu14@gmail.com',
                Modified_User: 'afrindinu14@gmail.com'
            },
            {
                EmployeeCode: 'SBE002',
                EmployeeName: 'Priya Sharma',
                Personalemailaddress: 'priya.sharma@sribalaji.com',
                Phone: '9876543211',
                DateofJoining: '2024-02-01',
                DateofBirth: '1992-08-20',
                FathersName: 'Ramesh Sharma',
                Age: 32,
                Gender: 'Female',
                MaritalStatus: 'Unmarried',
                PresentAddressLine1: '456 Park Avenue, Chennai',
                PresentState: 'Tamil Nadu',
                PresentCountry: 'India',
                ContractorName: 'Sri Balaji Enterprises',
                Department: 'Quality Control',
                Designation: 'Quality Inspector',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789013',
                Added_User: 'afrindinu14@gmail.com',
                Modified_User: 'afrindinu14@gmail.com'
            },
            {
                EmployeeCode: 'SBE003',
                EmployeeName: 'Amit Patel',
                Personalemailaddress: 'amit.patel@sribalaji.com',
                Phone: '9876543212',
                DateofJoining: '2024-03-10',
                DateofBirth: '1988-12-15',
                FathersName: 'Vikram Patel',
                Age: 36,
                Gender: 'Male',
                MaritalStatus: 'Married',
                PresentAddressLine1: '789 Industrial Area, Chennai',
                PresentState: 'Tamil Nadu',
                PresentCountry: 'India',
                ContractorName: 'Sri Balaji Enterprises',
                Department: 'Maintenance',
                Designation: 'Maintenance Engineer',
                employeeStatus: 'Active',
                aadhaarNumber: '123456789014',
                Added_User: 'afrindinu14@gmail.com',
                Modified_User: 'afrindinu14@gmail.com'
            }
        ];
        
        const createdEmployees = [];
        
        for (const employee of employees) {
            try {
                console.log(`Creating employee: ${employee.EmployeeName}`);
                const { ROWID: id } = await table.insertRow(employee);
                createdEmployees.push({
                    id: id,
                    name: employee.EmployeeName,
                    code: employee.EmployeeCode,
                    contractor: employee.ContractorName
                });
                console.log(`Created employee: ${employee.EmployeeName} with ID: ${id}`);
            } catch (error) {
                console.error(`Error creating employee ${employee.EmployeeName}:`, error);
            }
        }
        
        res.json({
            status: 'success',
            message: `Created ${createdEmployees.length} employees for Sri Balaji Enterprises`,
            data: {
                createdEmployees,
                contractorName: 'Sri Balaji Enterprises'
            }
        });
    } catch (error) {
        console.error('Error creating employees for afrindinu14:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Error creating employees',
            error: error.message
        });
    }
});

// Comprehensive debug endpoint for afrindinu14@gmail.com
app.get('/debug/afrindinu14-complete', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userEmail = 'afrindinu14@gmail.com';
        const userRole = 'App User';
        
        console.log('=== COMPREHENSIVE DEBUG FOR afrindinu14@gmail.com ===');
        
        // Step 1: Check all employees in database
        console.log('Step 1: Checking all employees in database...');
        const allEmployeesQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ORDER BY ContractorName`;
        const allEmployeesResult = await zcql.executeZCQLQuery(allEmployeesQuery);
        console.log(`Found ${allEmployeesResult.length} total employees in database`);
        
        // Step 2: Check employees for Sri Balaji Enterprises specifically
        console.log('Step 2: Checking employees for Sri Balaji Enterprises...');
        const sriBalajiQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sri Balaji Enterprises'`;
        const sriBalajiResult = await zcql.executeZCQLQuery(sriBalajiQuery);
        console.log(`Found ${sriBalajiResult.length} employees for Sri Balaji Enterprises`);
        
        // Step 3: Test the filtering logic exactly as it would be called
        console.log('Step 3: Testing filtering logic...');
        let contractorName = null;
        if (userEmail === "afrindinu14@gmail.com") {
            contractorName = "Sri Balaji Enterprises";
            console.log(`Filtering for contractor: ${contractorName}`);
        }
        
        // Step 4: Test the actual API call simulation
        console.log('Step 4: Testing API call simulation...');
        const apiQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${contractorName}'`;
        console.log(`API query: ${apiQuery}`);
        const apiResult = await zcql.executeZCQLQuery(apiQuery);
        console.log(`API result: Found ${apiResult.length} employees`);
        
        // Step 5: Check if we need to create employees
        console.log('Step 5: Checking if employees need to be created...');
        const needsEmployees = sriBalajiResult.length === 0;
        console.log(`Needs employees: ${needsEmployees}`);
        
        console.log('=== DEBUG COMPLETED ===');
        
        res.json({
            status: 'success',
            data: {
                userEmail,
                userRole,
                contractorName,
                totalEmployees: allEmployeesResult.length,
                sriBalajiEmployees: sriBalajiResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                sriBalajiCount: sriBalajiResult.length,
                apiResult: apiResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                apiCount: apiResult.length,
                needsEmployees,
                queries: {
                    allEmployeesQuery,
                    sriBalajiQuery,
                    apiQuery
                },
                recommendation: needsEmployees ? 
                    'Call POST /employees/create-for-afrindinu14 to create test employees' : 
                    'Employees exist, check frontend API call parameters'
            }
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Debug failed',
            error: error.message
        });
    }
});

// Comprehensive diagnostic endpoint for afrindinu14@gmail.com
app.get('/diagnose-afrindinu14', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userEmail = 'afrindinu14@gmail.com';
        const userRole = 'App User';
        
        console.log('=== COMPREHENSIVE DIAGNOSIS FOR afrindinu14@gmail.com ===');
        
        // Step 1: Check total employees
        const totalQuery = `SELECT COUNT(ROWID) as count FROM Employee`;
        const totalResult = await zcql.executeZCQLQuery(totalQuery);
        const totalEmployees = parseInt(totalResult[0].Employee['COUNT(ROWID)']) || 0;
        console.log(`Total employees in database: ${totalEmployees}`);
        
        // Step 2: Check all contractor names
        const contractorsQuery = `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName IS NOT NULL`;
        const contractorsResult = await zcql.executeZCQLQuery(contractorsQuery);
        const contractorNames = contractorsResult.map(row => row.Employee.ContractorName);
        console.log(`All contractor names:`, contractorNames);
        
        // Step 3: Check specifically for Sri Balaji Enterprises
        const sriBalajiQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sri Balaji Enterprises'`;
        const sriBalajiResult = await zcql.executeZCQLQuery(sriBalajiQuery);
        console.log(`Employees for Sri Balaji Enterprises: ${sriBalajiResult.length}`);
        
        // Step 4: Check for similar contractor names
        const similarQuery = `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Balaji%' OR ContractorName LIKE '%Sri%'`;
        const similarResult = await zcql.executeZCQLQuery(similarQuery);
        const similarNames = similarResult.map(row => row.Employee.ContractorName);
        console.log(`Similar contractor names:`, similarNames);
        
        // Step 5: Test the exact filtering logic
        console.log('Testing filtering logic...');
        let contractorName = null;
        if (userEmail === "afrindinu14@gmail.com") {
            contractorName = "Sri Balaji Enterprises";
            console.log(`Hardcoded contractor name: ${contractorName}`);
        }
        
        // Step 6: Test the actual query that would be executed
        const testQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${contractorName}'`;
        console.log(`Test query: ${testQuery}`);
        const testResult = await zcql.executeZCQLQuery(testQuery);
        console.log(`Test result: ${testResult.length} employees`);
        
        // Step 7: Check if we need to create employees or update existing ones
        const needsCreation = sriBalajiResult.length === 0;
        const needsUpdate = similarNames.length > 0 && sriBalajiResult.length === 0;
        
        res.json({
            status: 'success',
            data: {
                userEmail,
                userRole,
                totalEmployees,
                allContractorNames: contractorNames,
                sriBalajiEmployees: sriBalajiResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                sriBalajiCount: sriBalajiResult.length,
                similarContractorNames: similarNames,
                testQuery,
                testResult: testResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                testCount: testResult.length,
                needsCreation,
                needsUpdate,
                diagnosis: needsCreation ? 
                    'No employees exist for Sri Balaji Enterprises - need to create them' :
                    needsUpdate ?
                    'Similar contractor names exist but not exact match - may need to update' :
                    'Employees exist but filtering may have issues',
                recommendation: needsCreation ? 
                    'Call POST /fix-afrindinu14-employees to create employees' :
                    needsUpdate ?
                    'Check if contractor names need to be updated to exact match' :
                    'Check filtering logic in main endpoint'
            }
        });
    } catch (error) {
        console.error('Diagnosis error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Diagnosis failed',
            error: error.message
        });
    }
});

// Test endpoint to simulate exact frontend API call
app.get('/test-employees-api', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userEmail = req.query.userEmail || 'afrindinu14@gmail.com';
        const userRole = req.query.userRole || 'App User';
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        
        console.log('=== TESTING EXACT FRONTEND API CALL ===');
        console.log('Parameters:', { userEmail, userRole, page, perPage });
        
        const zcql = catalyst.zcql();
        
        // Build WHERE clause for contractor filtering (exact same logic as main endpoint)
        let whereClause = '';
        let countWhereClause = '';
       
        // If user is App User (contractor), filter by contractor email
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;
           
            // Check hardcoded mappings
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                contractorName = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                    }
                } catch (error) {
                    console.error('Error filtering by contractor:', error);
                }
            }
           
            // Filter employees by contractor name (case-insensitive)
            if (contractorName) {
                // Escape single quotes in contractor name to prevent SQL injection
                const escapedContractorName = contractorName.replace(/'/g, "''");
                whereClause = `WHERE LOWER(ContractorName) = LOWER('${escapedContractorName}')`;
                countWhereClause = `WHERE LOWER(ContractorName) = LOWER('${escapedContractorName}')`;
                console.log(`Filtering employees for contractor (case-insensitive): ${contractorName}`);
            }
        }

        // Get total count
        const countQuery = `SELECT COUNT(ROWID) as count FROM Employee ${countWhereClause}`;
        console.log(`Count query: ${countQuery}`);
        const countRows = await zcql.executeZCQLQuery(countQuery);
        const total = parseInt(countRows[0].Employee['COUNT(ROWID)']) || 0;
        console.log(`Total employees found: ${total}`);

        // Get employees with pagination
        const limitClause = `LIMIT ${(page - 1) * perPage + 1},${perPage}`;
        const employeeQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ${whereClause} ORDER BY ROWID DESC ${limitClause}`;
        console.log(`Employee query: ${employeeQuery}`);
        const employeeRows = await zcql.executeZCQLQuery(employeeQuery);
        
        const employees = employeeRows.map(row => ({
            id: row.Employee.ROWID,
            employeeName: row.Employee.EmployeeName,
            employeeCode: row.Employee.EmployeeCode,
            contractor: row.Employee.ContractorName
        }));
        
        console.log(`Returning ${employees.length} employees`);
        
        res.json({
            status: 'success',
            data: {
                employees,
                total,
                hasMore: page * perPage < total,
                page,
                perPage,
                whereClause,
                contractorName: (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") ? "Yashaswi Academy for Skills" : null
            }
        });
    } catch (error) {
        console.error('Test API error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Test API failed',
            error: error.message
        });
    }
});

// Debug endpoint for afrindinu14@gmail.com - check employees
app.get('/debug/afrindinu14-employees', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userEmail = 'afrindinu14@gmail.com';
        const userRole = 'App User';
        
        console.log('=== DEBUG FOR afrindinu14@gmail.com ===');
        
        // Step 1: Check all employees with Yashaswi Academy for Skills
        console.log('Step 1: Checking employees for Yashaswi Academy for Skills...');
        const yashaswiQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Yashaswi Academy for Skills'`;
        const yashaswiResult = await zcql.executeZCQLQuery(yashaswiQuery);
        console.log(`Found ${yashaswiResult.length} employees for Yashaswi Academy for Skills`);
        
        // Step 2: Test the filtering logic
        console.log('Step 2: Testing filtering logic...');
        let contractorName = null;
        if (userEmail === "afrindinu14@gmail.com") {
            contractorName = "Yashaswi Academy for Skills";
            console.log(`Filtering for contractor: ${contractorName}`);
        }
        
        // Step 3: Test the actual filtering query
        console.log('Step 3: Testing filtering query...');
        const filterQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = '${contractorName}'`;
        console.log(`Filter query: ${filterQuery}`);
        
        const filterResult = await zcql.executeZCQLQuery(filterQuery);
        console.log(`Filter result: Found ${filterResult.length} employees`);
        
        console.log('=== DEBUG COMPLETED ===');
        
        res.json({
            status: 'success',
            data: {
                userEmail,
                userRole,
                contractorName,
                yashaswiEmployees: yashaswiResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                yashaswiCount: yashaswiResult.length,
                filteredEmployees: filterResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                filteredCount: filterResult.length,
                testQuery: filterQuery,
                source: 'debug_endpoint'
            }
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Debug failed',
            error: error.message
        });
    }
});

// Debug endpoint for dinushaafrin@gmail.com - check employees
app.get('/debug/dinushaafrin-employees', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userEmail = 'dinushaafrin@gmail.com';
        const userRole = 'App User';
        
        console.log('=== DEBUG FOR dinushaafrin@gmail.com ===');
        
        // Step 1: Check all employees with Sri Balaji Enterprises
        console.log('Step 1: Checking employees for Sri Balaji Enterprises...');
        const sriBalajiQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sri Balaji Enterprises'`;
        const sriBalajiResult = await zcql.executeZCQLQuery(sriBalajiQuery);
        console.log(`Found ${sriBalajiResult.length} employees for Sri Balaji Enterprises`);
        
        // Step 2: Check all contractors
        console.log('Step 2: Checking all contractors...');
        const allContractorsQuery = `SELECT ROWID, ContractorName, PrimaryEmail FROM Contractors ORDER BY ContractorName`;
        const allContractorsResult = await zcql.executeZCQLQuery(allContractorsQuery);
        console.log(`Found ${allContractorsResult.length} total contractors`);
        
        // Step 3: Check all employees
        console.log('Step 3: Checking all employees...');
        const allEmployeesQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ORDER BY ContractorName`;
        const allEmployeesResult = await zcql.executeZCQLQuery(allEmployeesQuery);
        console.log(`Found ${allEmployeesResult.length} total employees`);
        
        console.log('=== DEBUG COMPLETED ===');
        
        res.json({
            status: 'success',
            data: {
                userEmail,
                userRole,
                sriBalajiEmployees: sriBalajiResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                sriBalajiCount: sriBalajiResult.length,
                allContractors: allContractorsResult.map(row => ({
                    id: row.Contractors.ROWID,
                    name: row.Contractors.ContractorName,
                    email: row.Contractors.PrimaryEmail
                })),
                allEmployees: allEmployeesResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                source: 'debug_endpoint'
            }
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Debug failed',
            error: error.message
        });
    }
});

// Comprehensive debug endpoint for afrindinusha29@gmail.com
app.get('/debug/afrindinusha29-complete', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userEmail = 'afrindinusha29@gmail.com';
        const userRole = 'App User';
       
        console.log('=== COMPREHENSIVE DEBUG FOR afrindinusha29@gmail.com ===');
       
        // Step 1: Check if contractor exists
        console.log('Step 1: Checking contractor record...');
        const contractorQuery = `SELECT ROWID, ContractorName, PrimaryEmail FROM Contractors WHERE PrimaryEmail = '${userEmail}'`;
        const contractorResult = await zcql.executeZCQLQuery(contractorQuery);
        console.log('Contractor query result:', contractorResult);
       
        let contractorName = null;
        if (contractorResult.length > 0) {
            contractorName = contractorResult[0].Contractors.ContractorName;
            console.log(`✅ Found contractor: ${contractorName}`);
        } else {
            console.log('❌ No contractor found for email:', userEmail);
        }
       
        // Step 2: Check all employees with Sriram Enterprises
        console.log('Step 2: Checking employees for Sriram Enterprises...');
        const sriramQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee WHERE ContractorName = 'Sriram Enterprises'`;
        const sriramResult = await zcql.executeZCQLQuery(sriramQuery);
        console.log(`Found ${sriramResult.length} employees for Sriram Enterprises`);
       
        // Step 3: Test the actual filtering logic
        console.log('Step 3: Testing filtering logic...');
        let whereClause = '';
        if (contractorName) {
            whereClause = `WHERE ContractorName = '${contractorName}'`;
        }
       
        const filterQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ${whereClause}`;
        console.log('Filter query:', filterQuery);
        const filterResult = await zcql.executeZCQLQuery(filterQuery);
        console.log(`Filter result: ${filterResult.length} employees`);
       
        // Step 4: Check all contractors
        console.log('Step 4: Checking all contractors...');
        const allContractorsQuery = `SELECT ROWID, ContractorName, PrimaryEmail FROM Contractors ORDER BY ContractorName`;
        const allContractorsResult = await zcql.executeZCQLQuery(allContractorsQuery);
        console.log(`Found ${allContractorsResult.length} total contractors`);
       
        // Step 5: Check all employees
        console.log('Step 5: Checking all employees...');
        const allEmployeesQuery = `SELECT ROWID, EmployeeName, EmployeeCode, ContractorName FROM Employee ORDER BY ContractorName`;
        const allEmployeesResult = await zcql.executeZCQLQuery(allEmployeesQuery);
        console.log(`Found ${allEmployeesResult.length} total employees`);
       
        console.log('=== DEBUG COMPLETED ===');
       
        res.json({
            status: 'success',
            data: {
                userEmail,
                userRole,
                contractor: contractorResult.length > 0 ? {
                    id: contractorResult[0].Contractors.ROWID,
                    name: contractorResult[0].Contractors.ContractorName,
                    email: contractorResult[0].Contractors.PrimaryEmail
                } : null,
                contractorFound: contractorResult.length > 0,
                contractorName,
                sriramEmployees: sriramResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                sriramCount: sriramResult.length,
                filteredEmployees: filterResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                filteredCount: filterResult.length,
                allContractors: allContractorsResult.map(row => ({
                    id: row.Contractors.ROWID,
                    name: row.Contractors.ContractorName,
                    email: row.Contractors.PrimaryEmail
                })),
                allContractorsCount: allContractorsResult.length,
                allEmployees: allEmployeesResult.map(row => ({
                    id: row.Employee.ROWID,
                    name: row.Employee.EmployeeName,
                    code: row.Employee.EmployeeCode,
                    contractor: row.Employee.ContractorName
                })),
                allEmployeesCount: allEmployeesResult.length,
                queries: {
                    contractorQuery,
                    sriBalajiQuery,
                    filterQuery,
                    allContractorsQuery,
                    allEmployeesQuery
                }
            }
        });
    } catch (error) {
        console.error('❌ Debug error:', error);
        res.status(500).json({
            status: 'failure',
            message: 'Debug failed',
            error: error.message
        });
    }
});

// ==================== BioMax API Endpoints ====================

// GET API: Get all BioMax records (with optional pagination)
app.get('/biomax', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
       
        console.log('BioMax fetch request:', { userEmail, userRole, page, perPage });
        const zcql = catalyst.zcql();

        // Get total count for pagination
        const countQuery = `SELECT COUNT(ROWID) as count FROM BioMax`;
        console.log(`Executing count query: ${countQuery}`);
        
        let countRows;
        let total = 0;
        try {
            countRows = await zcql.executeZCQLQuery(countQuery);
            console.log(`Count query result:`, countRows);
            total = parseInt(countRows[0].BioMax['COUNT(ROWID)']) || 0;
            console.log(`Total BioMax records found: ${total}`);
        } catch (countError) {
            console.error('Count query error:', countError);
            total = 0;
        }

        // Check if we should return all records (no pagination)
        const returnAll = !req.query.page && !req.query.perPage;
       
        // Build LIMIT clause
        const limitClause = returnAll ? '' : `LIMIT ${(page - 1) * perPage + 1},${perPage}`;

        // Query BioMax table
        const queryColumns = [
            'ROWID', 'EmployeeCode', 'EmployeeName', 'LogDate', 'CREATEDTIME', 'MODIFIEDTIME', 'CREATORID'
        ];
        const queryString = `SELECT ${queryColumns.join(', ')} FROM BioMax ORDER BY ROWID DESC ${limitClause}`;
        console.log(`Executing query: ${queryString}`);
        
        let queryResult;
        try {
            queryResult = await zcql.executeZCQLQuery(queryString);
            console.log(`Query result count: ${queryResult.length}`);
        } catch (queryError) {
            console.error('Query error:', queryError);
            queryResult = [];
        }

        // Transform results
        const biomaxRecords = queryResult.map(row => {
            const record = row.BioMax || {};
            return {
                id: record.ROWID,
                employeeCode: record.EmployeeCode || null,
                employeeName: record.EmployeeName || null,
                logDate: record.LogDate || null,
                createdTime: record.CREATEDTIME || null,
                modifiedTime: record.MODIFIEDTIME || null,
                creatorId: record.CREATORID || null
            };
        });

        const totalPages = Math.ceil(total / perPage);

        res.status(200).send({
            status: 'success',
            data: {
                biomax: biomaxRecords,
                total: total,
                page: page,
                perPage: perPage,
                totalPages: totalPages
            }
        });
    } catch (err) {
        console.error('BioMax fetch error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to fetch BioMax records.'
        });
    }
});

// POST API: Add a new BioMax record
app.post('/biomax', async (req, res) => {
    try {
        const {
            employeeCode, employeeName, logDate
        } = req.body;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('BioMax');

        // Validate mandatory fields
        if (!employeeCode || !employeeName || !logDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'Employee Code, Employee Name, and Log Date are required.'
            });
        }

        const userManagement = catalyst.userManagement();
        const userProfile = await userManagement.getCurrentUser();
        const userEmail = userProfile?.email_id || null;
        
        console.log('BioMax creation request:', { userEmail, employeeCode, employeeName, logDate });

        // Format logDate - handle both date-only (YYYY-MM-DD) and datetime formats
        let formattedLogDate = logDate;
        if (logDate && typeof logDate === 'string') {
            // If it's just a date (YYYY-MM-DD), convert to datetime (YYYY-MM-DD 00:00:00)
            if (/^\d{4}-\d{2}-\d{2}$/.test(logDate.trim())) {
                formattedLogDate = `${logDate.trim()} 00:00:00`;
            }
            // If it's already datetime format, use as is
            else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(logDate.trim())) {
                formattedLogDate = logDate.trim();
            }
            // Try to parse other date formats
            else {
                try {
                    const date = new Date(logDate);
                    if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        const hour = String(date.getHours()).padStart(2, '0');
                        const minute = String(date.getMinutes()).padStart(2, '0');
                        const second = String(date.getSeconds()).padStart(2, '0');
                        formattedLogDate = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                    }
                } catch (err) {
                    console.error('Date parsing error:', err);
                    return res.status(400).send({
                        status: 'failure',
                        message: 'Invalid date format for Log Date. Expected format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS'
                    });
                }
            }
        }

        // Insert new BioMax row
        const { ROWID: id } = await table.insertRow({
            EmployeeCode: employeeCode,
            EmployeeName: employeeName,
            LogDate: formattedLogDate
        });
        
        // Fetch the full BioMax row after insert
        const biomaxRow = await table.getRow(id);
        
        res.status(200).send({
            status: 'success',
            data: {
                biomax: {
                    id: biomaxRow.ROWID,
                    employeeCode: biomaxRow.EmployeeCode || null,
                    employeeName: biomaxRow.EmployeeName || null,
                    logDate: biomaxRow.LogDate || null,
                    createdTime: biomaxRow.CREATEDTIME || null,
                    modifiedTime: biomaxRow.MODIFIEDTIME || null,
                    creatorId: biomaxRow.CREATORID || null
                }
            }
        });
    } catch (err) {
        console.error('BioMax creation error:', err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// PUT API: Update a BioMax record by ROWID
app.put('/biomax/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const {
            employeeCode, employeeName, logDate
        } = req.body;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('BioMax');

        // Validate mandatory fields
        if (!employeeCode || !employeeName || !logDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'Employee Code, Employee Name, and Log Date are required.'
            });
        }

        const userManagement = catalyst.userManagement();
        const userProfile = await userManagement.getCurrentUser();
        const userEmail = userProfile?.email_id || null;

        console.log('BioMax update request:', { ROWID, userEmail, employeeCode, employeeName, logDate });

        // Format logDate - handle both date-only (YYYY-MM-DD) and datetime formats
        let formattedLogDate = logDate;
        if (logDate && typeof logDate === 'string') {
            // If it's just a date (YYYY-MM-DD), convert to datetime (YYYY-MM-DD 00:00:00)
            if (/^\d{4}-\d{2}-\d{2}$/.test(logDate.trim())) {
                formattedLogDate = `${logDate.trim()} 00:00:00`;
            }
            // If it's already datetime format, use as is
            else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(logDate.trim())) {
                formattedLogDate = logDate.trim();
            }
            // Try to parse other date formats
            else {
                try {
                    const date = new Date(logDate);
                    if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        const hour = String(date.getHours()).padStart(2, '0');
                        const minute = String(date.getMinutes()).padStart(2, '0');
                        const second = String(date.getSeconds()).padStart(2, '0');
                        formattedLogDate = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                    }
                } catch (err) {
                    console.error('Date parsing error:', err);
                    return res.status(400).send({
                        status: 'failure',
                        message: 'Invalid date format for Log Date. Expected format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS'
                    });
                }
            }
        }

        // Update BioMax row
        await table.updateRow({
            ROWID: ROWID,
            EmployeeCode: employeeCode,
            EmployeeName: employeeName,
            LogDate: formattedLogDate
        });
        
        // Fetch the updated BioMax row
        const biomaxRow = await table.getRow(ROWID);
        
        res.status(200).send({
            status: 'success',
            data: {
                biomax: {
                    id: biomaxRow.ROWID,
                    employeeCode: biomaxRow.EmployeeCode || null,
                    employeeName: biomaxRow.EmployeeName || null,
                    logDate: biomaxRow.LogDate || null,
                    createdTime: biomaxRow.CREATEDTIME || null,
                    modifiedTime: biomaxRow.MODIFIEDTIME || null,
                    creatorId: biomaxRow.CREATORID || null
                }
            }
        });
    } catch (err) {
        console.error('BioMax update error:', err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// DELETE API: Delete a BioMax record by ROWID
app.delete('/biomax/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('BioMax');

        console.log('BioMax delete request:', { ROWID });

        // Delete the BioMax row
        await table.deleteRow(ROWID);
        
        res.status(200).send({
            status: 'success',
            message: 'BioMax record deleted successfully.'
        });
    } catch (err) {
        console.error('BioMax delete error:', err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Failed to delete BioMax record."
        });
    }
});


module.exports = app;
