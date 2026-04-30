const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const app = express();
const axios = require('axios');

app.use(express.json());
app.use(fileUpload());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Use the new Folder ID provided by the user for candidate photos
const PHOTO_FOLDER_ID = '21320000000042999'; 

// GET API: Get all candidates (with pagination and multi-query for all columns)
app.get('/candidates', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        const userRole = req.query.userRole; // Get user role from query params
        const zcql = catalyst.zcql();

        const userEmail = req.query.userEmail; // Get user email from query params
        console.log('Candidate fetch request:', { userRole, userEmail, page, perPage });

        // Helper: normalize whitespace (collapse multiple spaces / NBSPs) and trim
        const normalizeName = (s) => (s || '').replace(/\s+/g, ' ').trim();

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
                // Use "Samuel Enterprises" directly since we know it exists in the database
                // (as confirmed by the database screenshot showing ContractorName: "Samuel Enterprises")
                contractorName = "Samuel Enterprises";
                console.log(`Using Samuel contractor name: ${contractorName}`);
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail.replace(/'/g, "''")}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                    }
                } catch (error) {
                    console.error('Error filtering by contractor:', error);
                }
            }
           
            // Filter candidates by contractor name (case-insensitive)
            // Special handling for Samuel and Sri Balaji users - use flexible matching
            const isSamuelUser = userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com";
            const isSriBalajiUser = userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com";
            
            if (isSamuelUser) {
                // For Samuel users, use the contractor name we found (or default to "Samuel Enterprises")
                // Use exact match since we know the exact value from the database
                const samuelContractorName = contractorName || "Samuel Enterprises";
                const escapedSamuelName = samuelContractorName.replace(/'/g, "''");
                
                whereClause = `WHERE ContractorName = '${escapedSamuelName}'`;
                countWhereClause = `WHERE ContractorName = '${escapedSamuelName}'`;
                console.log(`Filtering candidates for Samuel user (exact match): ${samuelContractorName}`);
                
                // Debug: Verify the query will work
                try {
                    const testQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, CandidateName, ContractorName FROM Candidate WHERE ContractorName = '${escapedSamuelName}' LIMIT 5`
                    );
                    console.log(`Debug - Test query with exact match "${samuelContractorName}" returned ${testQuery.length} results`);
                    if (testQuery.length > 0) {
                        console.log('Debug - Sample results:', testQuery.map(r => ({
                            name: r.Candidate?.CandidateName || r.candidate?.CandidateName,
                            contractor: r.Candidate?.ContractorName || r.candidate?.ContractorName
                        })));
                    }
                } catch (testErr) {
                    console.log('Debug test query failed:', testErr.message);
                }
            } else if (isSriBalajiUser) {
                // For Sri Balaji users, find a matching ContractorName value robustly by normalizing
                // database distinct names (handles multiple spaces, NBSPs, and subtle variations)
                let exactBalajiName = contractorName || "Sri Balaji Enterprises";
                try {
                    const balajiDistinctQuery = await zcql.executeZCQLQuery(
                        // Grab distinct contractor names (limited to reasonable number)
                        `SELECT DISTINCT ContractorName FROM Candidate LIMIT 200`
                    );

                    const matches = (balajiDistinctQuery || [])
                        .map(row => row.Candidate?.ContractorName || row.candidate?.ContractorName || row.ContractorName)
                        .filter(Boolean);

                    // Normalize and look for ones containing 'balaji'
                    const normalizedSearch = 'balaji';
                    const normalizedMatches = matches.filter(name => normalizeName(name).toLowerCase().includes(normalizedSearch));

                    if (normalizedMatches.length > 0) {
                        // Prefer an exact normalized match to our default phrase, otherwise take the first matching value
                        const normalizedExact = normalizedMatches.find(n => normalizeName(n).toLowerCase() === normalizeName('Sri Balaji Enterprises').toLowerCase());
                        exactBalajiName = normalizedExact || normalizedMatches[0];
                        console.log(`Found Sri Balaji contractor name in database: "${exactBalajiName}" (from ${normalizedMatches.length} normalized matches)`);
                        console.log(`All Balaji matches (normalized): ${normalizedMatches.map(m => '"' + normalizeName(m) + '"').join(', ')}`);
                    } else {
                        console.log('No Balaji contractor found in database (normalized search), using default: Sri Balaji Enterprises');
                        // Log sample distinct names (raw + normalized) to help debug unexpected characters/formatting
                        console.log('Distinct ContractorName values (sample):', matches.slice(0,20).map(n => ({ raw: n, normalized: normalizeName(n) })));
                    }
                } catch (balajiError) {
                    console.log(`Could not query Sri Balaji contractor name, using default: ${balajiError.message}`);
                }

                // Use exact match with the found contractor name (more reliable than LIKE)
                const escapedBalajiName = (exactBalajiName || '').replace(/'/g, "''");
                
                // First verify the exact match works, if not fall back to LIKE pattern
                let useExactMatch = true;
                try {
                    const testQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, CandidateName, ContractorName FROM Candidate WHERE ContractorName = '${escapedBalajiName}' LIMIT 5`
                    );
                    console.log(`Debug - Test query with exact match "${exactBalajiName}" returned ${testQuery.length} results`);
                    if (testQuery.length > 0) {
                        console.log('Debug - Sample results:', testQuery.map(r => ({
                            name: r.Candidate?.CandidateName || r.candidate?.CandidateName,
                            contractor: r.Candidate?.ContractorName || r.candidate?.ContractorName
                        })));
                        // Use exact match since it works
                        whereClause = `WHERE ContractorName = '${escapedBalajiName}'`;
                        countWhereClause = `WHERE ContractorName = '${escapedBalajiName}'`;
                        console.log(`Filtering candidates for Sri Balaji user (exact match): "${exactBalajiName}"`);
                    } else {
                        // If exact match fails, use LIKE pattern as fallback
                        useExactMatch = false;
                        console.log('Exact match returned 0 results, using LIKE pattern fallback...');
                        const patternWords = normalizeName(exactBalajiName).split(' ').filter(w => w.length > 0);
                        const pattern = patternWords.join('%');
                        whereClause = `WHERE ContractorName LIKE '%${pattern}%'`;
                        countWhereClause = `WHERE ContractorName LIKE '%${pattern}%'`;
                        console.log(`Filtering candidates for Sri Balaji user (LIKE pattern): "%${pattern}%"`);
                        
                        // Test the LIKE pattern
                        const likeTestQuery = await zcql.executeZCQLQuery(
                            `SELECT ROWID, CandidateName, ContractorName FROM Candidate WHERE ContractorName LIKE '%${pattern}%' LIMIT 5`
                        );
                        console.log(`Debug - LIKE pattern '%${pattern}%' returned ${likeTestQuery.length} results`);
                        if (likeTestQuery.length > 0) {
                            console.log('Debug - Pattern LIKE matches:', likeTestQuery.map(r => ({
                                name: r.Candidate?.CandidateName || r.candidate?.CandidateName,
                                contractor: r.Candidate?.ContractorName || r.candidate?.ContractorName
                            })));
                        }
                    }
                } catch (testErr) {
                    console.log('Debug test query failed, using LIKE pattern as fallback:', testErr.message);
                    // Fallback to LIKE pattern if test query fails
                    const patternWords = normalizeName(exactBalajiName).split(' ').filter(w => w.length > 0);
                    const pattern = patternWords.join('%');
                    whereClause = `WHERE ContractorName LIKE '%${pattern}%'`;
                    countWhereClause = `WHERE ContractorName LIKE '%${pattern}%'`;
                    console.log(`Filtering candidates for Sri Balaji user (LIKE pattern fallback): "%${pattern}%"`);
                }
            } else if (contractorName) {
                // Escape single quotes in contractor name to prevent SQL injection
                const escapedContractorName = contractorName.replace(/'/g, "''");
                
                // First, try to get the exact contractor name as stored in the Candidate table
                // This handles case variations
                let exactContractorName = contractorName;
                try {
                    // Build a LIKE pattern from normalized words in contractor name (collapses multiple spaces)
                    const words = normalizeName(contractorName).split(' ').filter(w => w.length > 0);
                    const pattern = words.join('%');
                    const contractorNameQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Candidate WHERE ContractorName LIKE '%${pattern}%' LIMIT 20`
                    );
                    if (contractorNameQuery && contractorNameQuery.length > 0) {
                        // Find the best match (exact match if available, otherwise first match)
                        const matches = contractorNameQuery.map(row => row.Candidate?.ContractorName || row.candidate?.ContractorName).filter(Boolean);
                        const exactMatch = matches.find(name => name.toLowerCase() === contractorName.toLowerCase());
                        exactContractorName = exactMatch || matches[0] || contractorName;
                        console.log(`Found contractor name in database: ${exactContractorName} (searched for: ${contractorName})`);
                    }
                } catch (nameError) {
                    console.log(`Could not query exact contractor name, using provided name: ${contractorName}. Error: ${nameError.message}`);
                }
                
                // Escape the exact contractor name
                const escapedExactName = exactContractorName.replace(/'/g, "''");
                
                // Use exact match with the contractor name as stored in database
                whereClause = `WHERE ContractorName = '${escapedExactName}'`;
                countWhereClause = `WHERE ContractorName = '${escapedExactName}'`;
                console.log(`Filtering candidates for contractor (exact match): ${exactContractorName}`);
            } else {
                // If no contractor found, don't show any candidates for App Users
                console.log(`No contractor found for user ${userEmail}, showing no candidates`);
                whereClause = `WHERE 1=0`; // Return no results
                countWhereClause = `WHERE 1=0`;
            }
        } else {
            // For App Administrators, show all candidates (no filtering)
            console.log('App Administrator or no user email - showing all candidates');
        }
        
        // First, let's test if the table exists and has any data
        try {
            const testQuery = `SELECT ROWID, CandidateName, Email FROM Candidate LIMIT 5`;
            console.log('Testing table access with query:', testQuery);
            const testResult = await zcql.executeZCQLQuery(testQuery);
            console.log('Test query result:', testResult);
            console.log('Test query result length:', testResult ? testResult.length : 0);
            
            if (testResult && testResult.length > 0) {
                console.log('Table exists and has data. First row structure:', testResult[0]);
                console.log('First row keys:', Object.keys(testResult[0]));
                if (testResult[0].Candidate) {
                    console.log('Candidate object keys:', Object.keys(testResult[0].Candidate));
                }
            } else {
                console.log('Table exists but has no data or query returned empty results');
                // Return empty results if no data found
                return res.status(200).send({
                    status: 'success',
                    data: {
                        candidates: [],
                        total: 0,
                        hasMore: false
                    }
                });
            }
        } catch (testError) {
            console.error('Test query failed:', testError);
            return res.status(500).send({
                status: 'failure',
                message: 'Database table access failed: ' + testError.message
            });
        }

        // Get total count for pagination with contractor filter
        const countQuery = `SELECT COUNT(ROWID) as count FROM Candidate ${countWhereClause}`;
        console.log('Count query:', countQuery);
        const countResult = await zcql.executeZCQLQuery(countQuery);
        console.log('Count result:', countResult);
        
        let total = 0;
        if (countResult && countResult.length > 0) {
            const container = countResult[0].Candidate || countResult[0].candidate || countResult[0];
            if (container) {
                const possibleKeys = Object.keys(container);
                console.log('Count result keys:', possibleKeys);
                for (const key of possibleKeys) {
                    if (key.includes('COUNT') || key === 'count') {
                        total = parseInt(container[key]) || 0;
                        console.log(`Count from key '${key}':`, total);
                        break;
                    }
                }
            }
        }
        
        console.log('Final total count:', total);
        
        console.log('Main candidates query count result:', countResult);
        console.log('Total candidates for pagination:', total);
        
        console.log('GET /candidates - Querying candidates with photo fields');

        // Use a single query with essential columns first
        // Base columns (<= 30) to satisfy ZCQL column limit
        const baseColumns = [
            'ROWID', 'ContractorName', 'CandidateName', 'ContractorSupervisor',
            'Email', 'Gender', 'Phone', 'Department', 'Designation', 'Skills',
            'DateofEngagement', 'ApprovalStatus', 'Status', 'Photo', 'PhotoFileId',
            'PresentAddressLine1', 'PresentCity', 'PresentState', 'PresentPostalCode', 'PresentCountry',
            'PermanentAddressLine1', 'PermanentCity', 'PermanentState', 'PermanentPostalCode', 'PermanentCountry',
            'CREATEDTIME', 'MODIFIEDTIME', 'Added_User', 'Modified_User'
        ];

        // Extra columns fetched in a second query and merged by ROWID
        const extraColumns = [
            'BloodGroup', 'MaritalStatus', 'EmergencyContactNumber', 'Fathersname',
            'AadhaarNumber', 'DOB', 'PANNumber', 'DrivingLicenseNumber', 'DriverLicenseExpiryDate',
            'Comments', 'Qualification', 'InstitutionName', 'FieldofStudy', 'YearofCompletion', 'Percent'
        ];
        
        const mainQuerySQL = `SELECT ${baseColumns.join(', ')} FROM Candidate ${whereClause} ORDER BY ROWID DESC LIMIT ${(page - 1) * perPage},${perPage}`;
        console.log('Main query SQL:', mainQuerySQL);
        console.log('WHERE clause being used:', whereClause);
        console.log('User email:', userEmail);
        console.log('Is Sri Balaji user:', userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com");
        
        let mainQuery;
        try {
            mainQuery = await zcql.executeZCQLQuery(mainQuerySQL);
            console.log('Main query result count:', mainQuery.length);
            console.log('Main query result:', mainQuery);
        } catch (mainError) {
            console.error('Main query failed:', mainError);
            // Try a simpler fallback query
            try {
                console.log('Trying fallback query...');
                const fallbackQuery = `SELECT ROWID, CandidateName, Email, ContractorName FROM Candidate ORDER BY ROWID DESC LIMIT 10`;
                mainQuery = await zcql.executeZCQLQuery(fallbackQuery);
                console.log('Fallback query result count:', mainQuery.length);
            } catch (fallbackError) {
                console.error('Fallback query also failed:', fallbackError);
                return res.status(500).send({
                    status: 'failure',
                    message: 'Failed to fetch candidates: ' + mainError.message
                });
            }
        }

        const candidateMap = {};
        
        // Process main query results with error handling
        mainQuery.forEach((row, index) => {
            console.log(`Main query row ${index}:`, row);
            
            // Handle different possible data structures
            let candidateData = null;
            let rowId = null;
            
            if (row && row.Candidate && row.Candidate.ROWID) {
                // Standard structure: row.Candidate.ROWID
                candidateData = row.Candidate;
                rowId = row.Candidate.ROWID;
            } else if (row && row.candidate && row.candidate.ROWID) {
                // Alternative structure: row.candidate.ROWID (lowercase)
                candidateData = row.candidate;
                rowId = row.candidate.ROWID;
            } else if (row && row.ROWID) {
                // Direct structure: row.ROWID
                candidateData = row;
                rowId = row.ROWID;
            }
            
            if (candidateData && rowId) {
                candidateMap[rowId] = candidateData;
                console.log(`Added candidate ${rowId} to map:`, candidateData);
            } else {
                console.error(`Invalid row structure in main query at index ${index}:`, row);
                console.log('Available keys in row:', Object.keys(row || {}));
            }
        });
        
        console.log('Raw candidate data from database:', candidateMap);
        console.log('Number of candidates found:', Object.keys(candidateMap).length);

        // If we have candidates and extra columns, fetch extra fields and merge
        const candidateIds = Object.keys(candidateMap);
        if (candidateIds.length > 0 && extraColumns.length > 0) {
            try {
                const extraQuerySQL = `SELECT ROWID, ${extraColumns.join(', ')} FROM Candidate WHERE ROWID IN (${candidateIds.join(',')})`;
                console.log('Extra fields query SQL:', extraQuerySQL);
                const extraQuery = await zcql.executeZCQLQuery(extraQuerySQL);
                console.log('Extra fields query result count:', extraQuery.length);
                extraQuery.forEach((row, idx) => {
                    let data = null;
                    let rowId = null;
                    if (row && row.Candidate && row.Candidate.ROWID) {
                        data = row.Candidate;
                        rowId = row.Candidate.ROWID;
                    } else if (row && row.candidate && row.candidate.ROWID) {
                        data = row.candidate;
                        rowId = row.candidate.ROWID;
                    } else if (row && row.ROWID) {
                        data = row;
                        rowId = row.ROWID;
                    }
                    if (rowId && candidateMap[rowId]) {
                        Object.assign(candidateMap[rowId], data);
                    } else {
                        console.warn('Extra fields row could not be merged at index', idx, row);
                    }
                });
            } catch (extraErr) {
                console.error('Extra fields query failed:', extraErr);
            }
        }
        
        const candidates = Object.values(candidateMap).map((row, index) => {
            try {
                if (!row || !row.ROWID) {
                    console.error(`Invalid candidate data at index ${index}:`, row);
                    return null;
                }
                
                const candidate = {
                    id: row.ROWID,
                    contractorName: row.ContractorName || null,
                    candidateName: row.CandidateName || null,
                    contractorSupervisor: row.ContractorSupervisor || null,
                    email: row.Email || null,
                    gender: row.Gender || null,
                    phone: row.Phone || null,
                    department: row.Department || null,
                    designation: row.Designation || null,
                    skills: row.Skills || null,
                    dateOfEngagement: row.DateofEngagement || null,
                    status: row.Status || null,
                    approvalStatus: row.ApprovalStatus || null,
                    photo: row.Photo || null,
                    photoFileId: row.PhotoFileId || null,
                    addedTime: row.CREATEDTIME || null,
                    modifiedTime: row.MODIFIEDTIME || null,
                    addedUser: row.Added_User || null,
                    modifiedUser: row.Modified_User || null,
                    // Add address and other fields that might be available
                    bloodGroup: row.BloodGroup || null,
                    maritalStatus: row.MaritalStatus || null,
                    emergencyContactNumber: row.EmergencyContactNumber || null,
                    fathersName: row.Fathersname || null,
                    aadhaarNumber: row.AadhaarNumber || null,
                    dob: row.DOB || null,
                    panNumber: row.PANNumber || null,
                    drivingLicenseNumber: row.DrivingLicenseNumber || null,
                    driverLicenseExpiryDate: row.DriverLicenseExpiryDate || null,
                    presentAddressLine1: row.PresentAddressLine1 || null,
                    presentCity: row.PresentCity || null,
                    presentState: row.PresentState || null,
                    presentPostalCode: row.PresentPostalCode || null,
                    presentCountry: row.PresentCountry || null,
                    permanentAddressLine1: row.PermanentAddressLine1 || null,
                    permanentCity: row.PermanentCity || null,
                    permanentState: row.PermanentState || null,
                    permanentPostalCode: row.PermanentPostalCode || null,
                    permanentCountry: row.PermanentCountry || null,
                    comments: row.Comments || null,
                    qualification: row.Qualification || null,
                    institution: row.InstitutionName || null,
                    fieldOfStudy: row.FieldofStudy || null,
                    yearOfCompletion: row.YearofCompletion || null,
                    percent: row.Percent || null
                };
                
                // Log photo data for debugging
                if (candidate.photo || candidate.photoFileId) {
                    console.log(`Candidate ${candidate.id} photo data:`, {
                        photo: candidate.photo,
                        photoFileId: candidate.photoFileId
                    });
                }
                
                console.log(`Processed candidate ${candidate.id}: ${candidate.candidateName}`);
                return candidate;
            } catch (error) {
                console.error(`Error processing candidate at index ${index}:`, error, row);
                return null;
            }
        }).filter(candidate => candidate !== null).sort((a, b) => b.id - a.id);

        console.log('Final candidates array length:', candidates.length);
        console.log('Final candidates:', candidates);
        console.log('Total count:', total);
        console.log('Has more:', page * perPage < total);

        const response = {
            status: 'success',
            data: {
                candidates,
                total,
                hasMore: page * perPage < total
            }
        };
        
        console.log('Sending response:', response);
        res.status(200).send(response);
    } catch (err) {
        console.error('GET /candidates error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || "We're unable to process the request."
        });
    }
});

// GET API: Get a single candidate by ID
app.get('/candidates/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const zcql = catalyst.zcql();
        const result = await zcql.executeZCQLQuery(`SELECT * FROM Candidate WHERE ROWID = ${id}`);
        if (result.length === 0) {
            return res.status(404).send({ status: 'failure', message: 'Candidate not found.' });
        }
        res.status(200).send({ status: 'success', data: { candidate: result[0].Candidate } });
    } catch (err) {
        console.error(`GET /candidates/${req.params.id} error:`, err);
        res.status(500).send({ status: 'failure', message: 'Failed to fetch candidate.' });
    }
});

// POST API: Add a new candidate
app.post('/candidates', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        const table = datastore.table('Candidate');
        const userProfile = await catalyst.userManagement().getCurrentUser();
        const userEmail = userProfile?.email_id || null;
       
        // Handle both form submissions (req.body.data) and import submissions (req.body directly)
        let candidateData;
        if (req.body.data) {
            // Form submission - data is wrapped in 'data' field
            candidateData = JSON.parse(req.body.data);
        } else {
            // Import submission - data is directly in req.body
            candidateData = req.body;
        }
       
        const {
            ContractorName, CandidateName, ContractorSupervisor, Email, Gender,
            BloodGroup, MaritalStatus, EmergencyContactNumber, Fathersname,
            AadhaarNumber, DOB, PANNumber, Designation, Phone,
            Department, Skills, DateOfEngagement, Status, DrivingLicenseNumber,
            DriverLicenseExpiryDate,
            PresentAddressLine1, PresentAddressLine2, PresentCity, PresentState,
            PresentPostalCode, PresentCountry, PermanentAddressLine1, PermanentAddressLine2,
            PermanentCity, PermanentState, PermanentPostalCode, PermanentCountry,
            ApprovalStatus, Comments,
            Qualification, InstitutionName, FieldofStudy, YearofCompletion,Percent
        } = candidateData;

        if (!CandidateName || !Email) {
            return res.status(400).send({ status: 'failure', message: 'Candidate Name and Email are required.' });
        }
        
        const trimmedCandidateName = CandidateName.trim();
        const trimmedEmail = Email.trim();

        // Check for duplicate email
        const zcql = catalyst.zcql();
        const existingEmailCheck = await zcql.executeZCQLQuery(
            `SELECT ROWID FROM Candidate WHERE Email = '${trimmedEmail}'`
        );
        if (existingEmailCheck.length > 0) {
            return res.status(409).send({ status: 'failure', message: `A candidate with email '${trimmedEmail}' already exists.` });
        }

        // Check for duplicate PAN Number if provided
        if (PANNumber && PANNumber.trim()) {
            const existingPanCheck = await zcql.executeZCQLQuery(
                `SELECT ROWID FROM Candidate WHERE PANNumber = '${PANNumber.trim()}'`
            );
            if (existingPanCheck.length > 0) {
                return res.status(409).send({ status: 'failure', message: `A candidate with PAN number '${PANNumber.trim()}' already exists.` });
            }
        }
        
        // Handle file upload (only for form submissions, not imports)
        let photoFileId = null;
        let photoFileName = null;
        if (req.files && req.files.photo) {
            try {
                const photo = req.files.photo;
                const folder = catalyst.filestore().folder(PHOTO_FOLDER_ID);
                const tempPath = `/tmp/${photo.name}`;
                await photo.mv(tempPath);
                const uploadResponse = await folder.uploadFile({
                    code: fs.createReadStream(tempPath),
                    name: photo.name,
                });
                fs.unlinkSync(tempPath); // Clean up temp file
                
                if (uploadResponse && uploadResponse.id) {
                    photoFileId = uploadResponse.id;
                    photoFileName = uploadResponse.file_name;
                } else {
                    console.error("Unexpected photo upload response:", uploadResponse);
                }
            } catch (uploadError) {
                console.error("Photo upload failed:", uploadError);
            }
        }

        const parseNumeric = (value) => {
            if (value === undefined || value === null || String(value).trim() === '') return null;
            const parsed = parseInt(String(value), 10);
            return isNaN(parsed) ? null : parsed;
        };

        // Auto-set ContractorName for Samuel and Sri Balaji users if not provided
        let finalContractorName = ContractorName || null;
        if (!finalContractorName && userEmail) {
            if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                // Try to find existing Samuel contractor name in database
                try {
                    const samuelQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Candidate WHERE ContractorName LIKE '%Samuel%' LIMIT 1`
                    );
                    if (samuelQuery && samuelQuery.length > 0) {
                        finalContractorName = samuelQuery[0].Candidate?.ContractorName || samuelQuery[0].candidate?.ContractorName || samuelQuery[0].ContractorName || "Samuel Enterprise";
                        console.log(`Auto-set ContractorName for Samuel user: ${finalContractorName}`);
                    } else {
                        finalContractorName = "Samuel Enterprise";
                        console.log(`No existing Samuel contractor found, using default: ${finalContractorName}`);
                    }
                } catch (samuelError) {
                    finalContractorName = "Samuel Enterprise";
                    console.log(`Error finding Samuel contractor, using default: ${finalContractorName}`);
                }
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                // Try to find existing Sri Balaji contractor name in database (may have spacing variations)
                try {
                    const balajiQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Candidate WHERE ContractorName LIKE '%Balaji%' LIMIT 1`
                    );
                    if (balajiQuery && balajiQuery.length > 0) {
                        finalContractorName = balajiQuery[0].Candidate?.ContractorName || balajiQuery[0].candidate?.ContractorName || balajiQuery[0].ContractorName || "Sri Balaji Enterprises";
                        console.log(`Auto-set ContractorName for Sri Balaji user: ${finalContractorName}`);
                    } else {
                        finalContractorName = "Sri Balaji Enterprises";
                        console.log(`No existing Sri Balaji contractor found, using default: ${finalContractorName}`);
                    }
                } catch (balajiError) {
                    finalContractorName = "Sri Balaji Enterprises";
                    console.log(`Error finding Sri Balaji contractor, using default: ${finalContractorName}`);
                }
            }
        }
        if (finalContractorName) {
            finalContractorName = String(finalContractorName).replace(/\s+/g, ' ').trim();
        }

        const rowData = {
            CandidateName: trimmedCandidateName,
            Email: trimmedEmail,
            ContractorName: finalContractorName,
            ContractorSupervisor: ContractorSupervisor || null,
            Gender: Gender || null,
            BloodGroup: BloodGroup || null,
            MaritalStatus: MaritalStatus || null,
            EmergencyContactNumber: parseNumeric(EmergencyContactNumber),
            Fathersname: Fathersname || null,
            AadhaarNumber: AadhaarNumber ? String(AadhaarNumber).trim() : null,
            DOB: DOB || null,
            PANNumber: PANNumber ? String(PANNumber).trim() : null,
            Designation: Designation || null,
            Phone: parseNumeric(Phone),
            Department: Department || null,
            Skills: Skills || null,
            DateofEngagement: DateOfEngagement || null,
            Status: Status || null,
            DrivingLicenseNumber: DrivingLicenseNumber || null,
            DriverLicenseExpiryDate: DriverLicenseExpiryDate || null,
            PresentAddressLine1: PresentAddressLine1 || null,
            PresentAddressLine2: PresentAddressLine2 || null,
            PresentCity: PresentCity || null,
            PresentState: PresentState || null,
            PresentPostalCode: PresentPostalCode || null,
            PresentCountry: PresentCountry || null,
            PermanentAddressLine1: PermanentAddressLine1 || null,
            PermanentAddressLine2: PermanentAddressLine2 || null,
            PermanentCity: PermanentCity || null,
            PermanentState: PermanentState || null,
            PermanentPostalCode: PermanentPostalCode || null,
            PermanentCountry: PermanentCountry || null,
            ApprovalStatus: ApprovalStatus || null,
            Comments: Comments || null,
            Qualification: Qualification || null,
            InstitutionName: InstitutionName || null,
            FieldofStudy: FieldofStudy || null,
            YearofCompletion: YearofCompletion || null,
            Percent:Percent || null,
            Added_User: userEmail,
            Modified_User: userEmail
        };
        
        if (photoFileName) {
            rowData.Photo = photoFileName;
        }
        if (photoFileId) {
            rowData.PhotoFileId = photoFileId;
        }

        const insertedRow = await table.insertRow(rowData);

        // --- Begin: Auto-create Employee if Approved on creation ---
        let employeeCreated = false;
        let employeeCreationError = null;
        
        // Log ApprovalStatus for debugging
        console.log('Candidate ApprovalStatus:', rowData.ApprovalStatus, 'Type:', typeof rowData.ApprovalStatus);
        
        if (
  rowData.ApprovalStatus &&
  typeof rowData.ApprovalStatus === 'string' &&
  rowData.ApprovalStatus.trim().toLowerCase() === 'approved'
) {
  try {
    console.log('Auto-create Employee logic triggered for candidate:', rowData);
    const employeeTable = datastore.table('Employee');
    const employeeZcql = catalyst.zcql();

    // Check for existing Employee by email
    let employeeExists = false;
    if (rowData.Email) {
      const existingEmployeeByEmail = await employeeZcql.executeZCQLQuery(
        `SELECT ROWID FROM Employee WHERE Personalemailaddress = '${rowData.Email.trim()}'`
      );
      employeeExists = existingEmployeeByEmail.length > 0;
    }

    // Check for existing Employee by PAN if not found by email
    if (!employeeExists && rowData.PANNumber) {
      const existingEmployeeByPAN = await employeeZcql.executeZCQLQuery(
        `SELECT ROWID FROM Employee WHERE PANNumber = '${rowData.PANNumber.trim()}'`
      );
      employeeExists = existingEmployeeByPAN.length > 0;
    }

    if (!employeeExists) {
      // Parse Phone number safely
      let phoneNumber = null;
      if (rowData.Phone) {
        if (typeof rowData.Phone === 'number') {
          phoneNumber = rowData.Phone;
        } else {
          const phoneStr = String(rowData.Phone).replace(/\D/g, '');
          if (phoneStr.length > 0) {
            phoneNumber = parseInt(phoneStr, 10);
            if (isNaN(phoneNumber)) phoneNumber = null;
          }
        }
      }
      
      // Parse Emergency Contact Number safely
      let emergencyContactNum = rowData.EmergencyContactNumber;
      if (emergencyContactNum && typeof emergencyContactNum !== 'number') {
        const emergencyStr = String(emergencyContactNum).replace(/\D/g, '');
        if (emergencyStr.length > 0) {
          emergencyContactNum = parseInt(emergencyStr, 10);
          if (isNaN(emergencyContactNum)) emergencyContactNum = null;
        }
      }
      
      // Parse education details if available
      let qualification = null, institutionName = null, fieldOfStudy = null, yearOfCompletion = null, percentageMarks = null;
      if (rowData.Qualification || rowData.InstitutionName || rowData.FieldofStudy || rowData.YearofCompletion || rowData.Percent) {
        qualification = rowData.Qualification || null;
        institutionName = rowData.InstitutionName || null;
        fieldOfStudy = rowData.FieldofStudy || null;
        yearOfCompletion = rowData.YearofCompletion ? parseInt(rowData.YearofCompletion, 10) : null;
        if (isNaN(yearOfCompletion)) yearOfCompletion = null;
        percentageMarks = rowData.Percent || null;
      }
      
      // Normalize ContractorName: trim whitespace to ensure proper matching in employee filter
      const normalizedContractorName = rowData.ContractorName 
        ? String(rowData.ContractorName).trim() 
        : null;
      
      console.log('Creating employee (POST) - Original ContractorName:', rowData.ContractorName, 'Normalized:', normalizedContractorName);
      
      const employeeRow = {
        EmployeeCode: null, // Leave EmployeeCode blank, don't auto-generate
        EmployeeName: rowData.CandidateName || '',
        Personalemailaddress: rowData.Email || '',
        Phone: phoneNumber,
        DateofJoining: rowData.DateofEngagement ? (typeof rowData.DateofEngagement === 'string' ? rowData.DateofEngagement : String(rowData.DateofEngagement)) : null,
        FathersName: rowData.Fathersname ? String(rowData.Fathersname).trim() : null,
        Gender: rowData.Gender ? String(rowData.Gender).trim() : null,
        BloodGroup: rowData.BloodGroup ? String(rowData.BloodGroup).trim() : null,
        MaritalStatus: rowData.MaritalStatus ? String(rowData.MaritalStatus).trim() : null,
        EmergencyContactNumber: emergencyContactNum,
        DateofBirth: rowData.DOB ? (typeof rowData.DOB === 'string' ? rowData.DOB : String(rowData.DOB)) : null,
        panNumber: rowData.PANNumber ? String(rowData.PANNumber).trim() : null,
        aadhaarNumber: rowData.AadhaarNumber ? String(rowData.AadhaarNumber).trim() : null,
        ContractorName: normalizedContractorName,
        Department: rowData.Department ? String(rowData.Department).trim() : null,
        Designation: rowData.Designation ? String(rowData.Designation).trim() : null,
        ContractorSupervisor: rowData.ContractorSupervisor ? String(rowData.ContractorSupervisor).trim() : null,
        DrivingLicenseNumber: rowData.DrivingLicenseNumber ? String(rowData.DrivingLicenseNumber).trim() : null,
        DrivingLicenseExpiryDate: rowData.DriverLicenseExpiryDate ? (typeof rowData.DriverLicenseExpiryDate === 'string' ? rowData.DriverLicenseExpiryDate : String(rowData.DriverLicenseExpiryDate)) : null,
        PresentAddressLine1: rowData.PresentAddressLine1 ? String(rowData.PresentAddressLine1).trim() : null,
        PresentAddressLine2: rowData.PresentAddressLine2 ? String(rowData.PresentAddressLine2).trim() : null,
        PresentCity: rowData.PresentCity ? String(rowData.PresentCity).trim() : null,
        PresentState: rowData.PresentState ? String(rowData.PresentState).trim() : null,
        PresentPostalCode: rowData.PresentPostalCode ? String(rowData.PresentPostalCode).trim() : null,
        PresentCountry: rowData.PresentCountry ? String(rowData.PresentCountry).trim() : null,
        PermanentAddressLine1: rowData.PermanentAddressLine1 ? String(rowData.PermanentAddressLine1).trim() : null,
        PermanentAddressLine2: rowData.PermanentAddressLine2 ? String(rowData.PermanentAddressLine2).trim() : null,
        PermanentCity: rowData.PermanentCity ? String(rowData.PermanentCity).trim() : null,
        PermanentState: rowData.PermanentState ? String(rowData.PermanentState).trim() : null,
        PermanentPostalCode: rowData.PermanentPostalCode ? String(rowData.PermanentPostalCode).trim() : null,
        PermanentCountry: rowData.PermanentCountry ? String(rowData.PermanentCountry).trim() : null,
        // Education details (first entry only, can be expanded to JSON if needed)
        Qualification: qualification,
        InstitutionName: institutionName,
        FieldOfStudy: fieldOfStudy,
        YearOfCompletion: yearOfCompletion,
        PercentageMarks: percentageMarks,
        // Set default status
        employeeStatus: 'Active',
        Added_User: userEmail || null,
        Modified_User: userEmail || null
      };
      console.log('Attempting to insert employee row (on create):', employeeRow);
      console.log('Employee row keys:', Object.keys(employeeRow));
      console.log('Employee row values:', JSON.stringify(employeeRow, null, 2));
      
      try {
        const newEmp = await employeeTable.insertRow(employeeRow);
        console.log(`Successfully created employee for candidate ${rowData.CandidateName}`, newEmp);
        console.log(`Employee created for Contractor: ${rowData.ContractorName || 'N/A'}`);
        employeeCreated = true;
      } catch (insertErr) {
        employeeCreationError = insertErr;
        console.error('Error inserting new employee row (on create):', insertErr);
        console.error('Error message:', insertErr.message);
        console.error('Error stack:', insertErr.stack);
        console.error('Failed employee row data:', JSON.stringify(employeeRow, null, 2));
        
        // Fallback: try minimal insert to ensure employee exists, then update remaining fields
        try {
          // Normalize ContractorName for fallback insert as well
          const fallbackContractorName = rowData.ContractorName 
            ? String(rowData.ContractorName).trim() 
            : null;
          
          const minimal = {
            EmployeeCode: null, // Leave EmployeeCode blank, don't auto-generate
            EmployeeName: employeeRow.EmployeeName || (rowData.CandidateName || ''),
            Personalemailaddress: employeeRow.Personalemailaddress || (rowData.Email || null),
            ContractorName: employeeRow.ContractorName || fallbackContractorName,
            employeeStatus: 'Active',
            Added_User: userEmail || null,
            Modified_User: userEmail || null
          };
          console.log('Attempting minimal employee insert (on create) due to previous error:', minimal);
          const minimalEmp = await employeeTable.insertRow(minimal);
          console.log('Minimal insert succeeded (on create):', minimalEmp);
          employeeCreated = true;

          // Attempt to update the record with remaining fields
          const updateFields = Object.assign({}, employeeRow);
          delete updateFields.EmployeeCode;
          delete updateFields.EmployeeName;
          delete updateFields.Personalemailaddress;
          delete updateFields.ContractorName;
          delete updateFields.employeeStatus;
          delete updateFields.Added_User;
          delete updateFields.Modified_User;
          // Remove Skills field as it doesn't exist in Employee table
          delete updateFields.Skills;
          updateFields.ROWID = minimalEmp.ROWID;
          
          console.log('Attempting to update employee with remaining fields:', updateFields);
          try {
            const updatedEmp = await employeeTable.updateRow(updateFields);
            console.log('Updated employee after minimal insert (on create):', updatedEmp);
          } catch (updateErr) {
            console.error('Failed to update employee after minimal insert (on create):', updateErr);
            console.error('Update error message:', updateErr.message);
            console.error('Update error stack:', updateErr.stack);
            console.error('Failed update fields:', JSON.stringify(updateFields, null, 2));
            // Don't fail the whole operation if update fails - at least employee was created
          }
        } catch (fallbackErr) {
          console.error('Fallback minimal insert failed (on create):', fallbackErr);
          console.error('Fallback error message:', fallbackErr.message);
          console.error('Fallback error stack:', fallbackErr.stack);
          employeeCreated = false;
          employeeCreationError = fallbackErr;
        }
      }
      
      // Log final result
      if (employeeCreated) {
        console.log(`✓ Employee successfully created for candidate: ${rowData.CandidateName}`);
      } else {
        console.error(`✗ Failed to create employee for candidate: ${rowData.CandidateName}`);
        if (employeeCreationError) {
          console.error('Employee creation error details:', employeeCreationError.message);
        }
      }
    } else {
      console.log('Employee already exists for this candidate. Updating with candidate data...');
      
      // Update existing employee with candidate data to ensure all fields are populated
      try {
        const existingEmployeeByEmail = await employeeZcql.executeZCQLQuery(
          `SELECT ROWID FROM Employee WHERE Personalemailaddress = '${rowData.Email.trim().replace(/'/g, "''")}'`
        );
        
        if (existingEmployeeByEmail.length > 0) {
          const employeeRowId = existingEmployeeByEmail[0].Employee?.ROWID || existingEmployeeByEmail[0].ROWID;
          console.log(`Found existing employee ROWID: ${employeeRowId}, updating with candidate data...`);
          
          // Build update object with all candidate fields
          const updateData = {
            ROWID: employeeRowId,
            EmployeeName: rowData.CandidateName || null,
            Personalemailaddress: rowData.Email || null,
            Phone: phoneNumber,
            DateofJoining: rowData.DateofEngagement ? (typeof rowData.DateofEngagement === 'string' ? rowData.DateofEngagement : String(rowData.DateofEngagement)) : null,
            FathersName: rowData.Fathersname ? String(rowData.Fathersname).trim() : null,
            Gender: rowData.Gender ? String(rowData.Gender).trim() : null,
            BloodGroup: rowData.BloodGroup ? String(rowData.BloodGroup).trim() : null,
            MaritalStatus: rowData.MaritalStatus ? String(rowData.MaritalStatus).trim() : null,
            EmergencyContactNumber: emergencyContactNum,
            DateofBirth: rowData.DOB ? (typeof rowData.DOB === 'string' ? rowData.DOB : String(rowData.DOB)) : null,
            panNumber: rowData.PANNumber ? String(rowData.PANNumber).trim() : null,
            aadhaarNumber: rowData.AadhaarNumber ? String(rowData.AadhaarNumber).trim() : null,
            ContractorName: normalizedContractorName,
            Department: rowData.Department ? String(rowData.Department).trim() : null,
            Designation: rowData.Designation ? String(rowData.Designation).trim() : null,
            ContractorSupervisor: rowData.ContractorSupervisor ? String(rowData.ContractorSupervisor).trim() : null,
            DrivingLicenseNumber: rowData.DrivingLicenseNumber ? String(rowData.DrivingLicenseNumber).trim() : null,
            DrivingLicenseExpiryDate: rowData.DriverLicenseExpiryDate ? (typeof rowData.DriverLicenseExpiryDate === 'string' ? rowData.DriverLicenseExpiryDate : String(rowData.DriverLicenseExpiryDate)) : null,
            PresentAddressLine1: rowData.PresentAddressLine1 ? String(rowData.PresentAddressLine1).trim() : null,
            PresentAddressLine2: rowData.PresentAddressLine2 ? String(rowData.PresentAddressLine2).trim() : null,
            PresentCity: rowData.PresentCity ? String(rowData.PresentCity).trim() : null,
            PresentState: rowData.PresentState ? String(rowData.PresentState).trim() : null,
            PresentPostalCode: rowData.PresentPostalCode ? String(rowData.PresentPostalCode).trim() : null,
            PresentCountry: rowData.PresentCountry ? String(rowData.PresentCountry).trim() : null,
            PermanentAddressLine1: rowData.PermanentAddressLine1 ? String(rowData.PermanentAddressLine1).trim() : null,
            PermanentAddressLine2: rowData.PermanentAddressLine2 ? String(rowData.PermanentAddressLine2).trim() : null,
            PermanentCity: rowData.PermanentCity ? String(rowData.PermanentCity).trim() : null,
            PermanentState: rowData.PermanentState ? String(rowData.PermanentState).trim() : null,
            PermanentPostalCode: rowData.PermanentPostalCode ? String(rowData.PermanentPostalCode).trim() : null,
            PermanentCountry: rowData.PermanentCountry ? String(rowData.PermanentCountry).trim() : null,
            Qualification: qualification,
            InstitutionName: institutionName,
            FieldOfStudy: fieldOfStudy,
            YearOfCompletion: yearOfCompletion,
            PercentageMarks: percentageMarks,
            Modified_User: userEmail || null
          };
          
          console.log('Updating existing employee with candidate data:', JSON.stringify(updateData, null, 2));
          const updatedEmployee = await employeeTable.updateRow(updateData);
          console.log(`✓ Successfully updated existing employee for candidate: ${rowData.CandidateName}`, updatedEmployee);
          employeeCreated = true; // Mark as "handled" since we updated the employee
        }
      } catch (updateErr) {
        console.error('Failed to update existing employee with candidate data:', updateErr);
        console.error('Update error:', updateErr.message);
        employeeCreated = false;
        employeeCreationError = updateErr;
      }
    }
  } catch (employeeErr) {
    console.error('Failed to create employee from approved candidate (on creation):', employeeErr);
    employeeCreated = false;
    employeeCreationError = employeeErr;
  }
}
        // --- End: Auto-create Employee if Approved on creation ---

        // Prepare response with employee creation status
        const responseData = {
            candidate: {
                id: insertedRow.ROWID,
                ...rowData,
                fathersName: rowData.Fathersname, // frontend expects fathersName
            }
        };
        
        // Include employee creation info if auto-create was attempted
        const wasApproved = rowData.ApprovalStatus && typeof rowData.ApprovalStatus === 'string' && rowData.ApprovalStatus.trim().toLowerCase() === 'approved';
        if (wasApproved) {
            responseData.employeeCreated = employeeCreated;
            if (employeeCreationError) {
                responseData.employeeCreationError = employeeCreationError.message || 'Failed to create employee';
                responseData.employeeCreationWarning = 'Candidate created successfully, but employee creation failed. Please check logs for details.';
            }
        } else {
            console.log('Employee not auto-created - ApprovalStatus is not "approved". Status:', rowData.ApprovalStatus);
            responseData.employeeCreated = false;
            responseData.employeeCreationNote = 'Employee will be created when candidate is approved.';
        }

        res.status(200).send({
            status: 'success',
            data: responseData
        });
    } catch (err) {
        console.error('POST /candidates error:', err);
        res.status(500).send({ status: 'failure', message: err.message || 'An error occurred while adding the candidate.' });
    }
});

// PUT API: Update a candidate by ROWID
app.put('/candidates/:ROWID', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        const table = datastore.table('Candidate');
        const userProfile = await catalyst.userManagement().getCurrentUser();
        const userEmail = userProfile?.email_id || null;
       
        const { ROWID } = req.params;
        // Accept both multipart FormData (req.body.data as JSON string) and raw JSON bodies
        let candidateData;
        if (req.body && typeof req.body.data === 'string') {
            try {
                candidateData = JSON.parse(req.body.data);
            } catch (e) {
                return res.status(400).send({ status: 'failure', message: 'Invalid candidate payload.' });
            }
        } else if (req.body && typeof req.body === 'object') {
            candidateData = req.body;
        } else {
            return res.status(400).send({ status: 'failure', message: 'Missing candidate payload.' });
        }
        const {
            ContractorName, CandidateName, ContractorSupervisor, Email, Gender,
            BloodGroup, MaritalStatus, EmergencyContactNumber, Fathersname,
            AadhaarNumber, DOB, PANNumber, Designation, Phone,
            Department, Skills, DateOfEngagement, Status, DrivingLicenseNumber,
            DriverLicenseExpiryDate,
            PresentAddressLine1, PresentAddressLine2, PresentCity, PresentState,
            PresentPostalCode, PresentCountry, PermanentAddressLine1, PermanentAddressLine2,
            PermanentCity, PermanentState, PermanentPostalCode, PermanentCountry,
            ApprovalStatus, Comments,
            Qualification, InstitutionName, FieldofStudy, YearofCompletion, Percent
        } = candidateData;

        // Log the received ApprovalStatus and candidateData
        console.log('PUT /candidates/:ROWID - Received ApprovalStatus:', ApprovalStatus);
        console.log('PUT /candidates/:ROWID - candidateData:', candidateData);
        console.log('PUT /candidates/:ROWID - Files received:', req.files);

        if (!CandidateName || !Email) {
            return res.status(400).send({ status: 'failure', message: 'Candidate Name and Email are required.' });
        }
        
        const trimmedCandidateName = CandidateName.trim();
        const trimmedEmail = Email.trim();

        const zcql = catalyst.zcql();
        // Check for duplicate PAN Number if provided (excluding current record)
        if (PANNumber && PANNumber.trim()) {
            const existingPanCheck = await zcql.executeZCQLQuery(
                `SELECT ROWID FROM Candidate WHERE PANNumber = '${PANNumber.trim()}' AND ROWID != ${ROWID}`
            );
            if (existingPanCheck.length > 0) {
                return res.status(409).send({ status: 'failure', message: `A candidate with PAN number '${PANNumber.trim()}' already exists.` });
            }
        }
        
        // Handle file upload
        let photoFileId = null;
        let photoFileName = null;
        if (req.files && req.files.photo) {
            try {
                console.log('Processing photo upload for candidate:', ROWID);
                const photo = req.files.photo;
                console.log('Photo details:', {
                    name: photo.name,
                    size: photo.size,
                    type: photo.type
                });
                
                const folder = catalyst.filestore().folder(PHOTO_FOLDER_ID);
                const tempPath = `/tmp/${photo.name}`;
                await photo.mv(tempPath);
                const uploadResponse = await folder.uploadFile({
                    code: fs.createReadStream(tempPath),
                    name: photo.name,
                });
                fs.unlinkSync(tempPath); // Clean up temp file
                
                console.log('Photo upload response:', uploadResponse);
                
                if (uploadResponse && uploadResponse.id) {
                    photoFileId = uploadResponse.id;
                    photoFileName = uploadResponse.file_name;
                    console.log('Photo uploaded successfully - FileId:', photoFileId, 'FileName:', photoFileName);
                } else {
                    console.error("Unexpected photo upload response:", uploadResponse);
                }
            } catch (uploadError) {
                console.error("Photo upload failed:", uploadError);
            }
        } else {
            console.log('No photo file received in request');
        }

        const parseNumeric = (value) => {
            if (value === undefined || value === null || String(value).trim() === '') return null;
            const parsed = parseInt(String(value), 10);
            return isNaN(parsed) ? null : parsed;
        };

        // Fetch existing candidate to preserve Added_User and existing photo data
        const existing = await table.getRow(ROWID);
        console.log('Existing candidate data:', existing);
        
        const rowData = {
            ROWID: ROWID,
            CandidateName: trimmedCandidateName,
            Email: trimmedEmail,
            ContractorName: (ContractorName ? String(ContractorName).replace(/\s+/g, ' ').trim() : null),
            ContractorSupervisor: ContractorSupervisor || null,
            Gender: Gender || null,
            BloodGroup: BloodGroup || null,
            MaritalStatus: MaritalStatus || null,
            EmergencyContactNumber: parseNumeric(EmergencyContactNumber),
            Fathersname: Fathersname || null,
            AadhaarNumber: parseNumeric(AadhaarNumber),
            DOB: DOB || null,
            PANNumber: PANNumber || null,
            Designation: Designation || null,
            Phone: parseNumeric(Phone),
            Department: Department || null,
            Skills: Skills || null,
            DateofEngagement: DateOfEngagement || null,
            Status: Status || null,
            DrivingLicenseNumber: DrivingLicenseNumber || null,
            DriverLicenseExpiryDate: DriverLicenseExpiryDate || null,
            PresentAddressLine1: PresentAddressLine1 || null,
            PresentAddressLine2: PresentAddressLine2 || null,
            PresentCity: PresentCity || null,
            PresentState: PresentState || null,
            PresentPostalCode: PresentPostalCode || null,
            PresentCountry: PresentCountry || null,
            PermanentAddressLine1: PermanentAddressLine1 || null,
            PermanentAddressLine2: PermanentAddressLine2 || null,
            PermanentCity: PermanentCity || null,
            PermanentState: PermanentState || null,
            PermanentPostalCode: PermanentPostalCode || null,
            PermanentCountry: PermanentCountry || null,
            ApprovalStatus: ApprovalStatus || null,
            Comments: Comments || null,
            Qualification: Qualification || null,
            InstitutionName: InstitutionName || null,
            FieldofStudy: FieldofStudy || null,
            YearofCompletion: YearofCompletion || null,
            Percent: Percent || null,
            Added_User: existing?.Added_User || null,
            Modified_User: userEmail
        };

        // Update photo data only if new photo was uploaded
        if (photoFileName) {
            rowData.Photo = photoFileName;
            console.log('Setting new photo filename:', photoFileName);
        } else if (existing?.Photo) {
            // Preserve existing photo if no new photo uploaded
            rowData.Photo = existing.Photo;
            console.log('Preserving existing photo filename:', existing.Photo);
        }
        
        if (photoFileId) {
            rowData.PhotoFileId = photoFileId;
            console.log('Setting new photo file ID:', photoFileId);
        } else if (existing?.PhotoFileId) {
            // Preserve existing photo file ID if no new photo uploaded
            rowData.PhotoFileId = existing.PhotoFileId;
            console.log('Preserving existing photo file ID:', existing.PhotoFileId);
        }

        console.log('Final row data for update:', rowData);
        console.log('Photo data in update:', {
          photoFileName: rowData.Photo,
          photoFileId: rowData.PhotoFileId,
          hadNewPhoto: !!photoFileName,
          hadNewPhotoId: !!photoFileId
        });
        
        const candidate = await table.updateRow(rowData);
        console.log('Candidate updated successfully:', candidate);
        console.log('Updated candidate photo data:', {
          photo: candidate.Photo,
          photoFileId: candidate.PhotoFileId
        });

        // --- Begin: Auto-create Employee if Approved ---
        // Flags for debugging and frontend confirmation
        let employeeCreated = false;
        let employeeCreatedDetails = null;
        try {
            // Fetch freshest candidate row from DB to ensure stored ApprovalStatus/fields
            const zcqlForCandidate = catalyst.zcql();
            const candidateResult = await zcqlForCandidate.executeZCQLQuery(`SELECT * FROM Candidate WHERE ROWID = ${ROWID}`);
            const updatedCandidateRow = (candidateResult && candidateResult[0]) ? (candidateResult[0].Candidate || candidateResult[0].candidate) : candidate;
            const approvalStatusValue = (updatedCandidateRow?.ApprovalStatus || '').toString().trim().toLowerCase();

            console.log('Auto-create check - approvalStatusValue:', approvalStatusValue, 'candidateId:', ROWID);

            if (approvalStatusValue === 'approved') {
                console.log('Auto-create Employee logic triggered for candidate (fresh row):', updatedCandidateRow);

                const employeeTable = datastore.table('Employee');
                const employeeZcql = catalyst.zcql();

                const escapeSQL = (s) => (s || '').toString().replace(/'/g, "''");

                // Check for existing Employee by email
                let employeeExists = false;
                try {
                    if (updatedCandidateRow?.Email) {
                        const emailEscaped = escapeSQL(updatedCandidateRow.Email.trim());
                        const existingEmployeeByEmail = await employeeZcql.executeZCQLQuery(
                            `SELECT ROWID FROM Employee WHERE Personalemailaddress = '${emailEscaped}'`
                        );
                        console.log('Existing employee by email count:', existingEmployeeByEmail.length);
                        employeeExists = existingEmployeeByEmail.length > 0;
                    }
                } catch (qErr) {
                    console.error('Error checking employee by email:', qErr);
                }

                // Check for existing Employee by PAN if not found by email
                try {
                    if (!employeeExists && updatedCandidateRow?.PANNumber) {
                        const panEscaped = escapeSQL(updatedCandidateRow.PANNumber.trim());
                        const existingEmployeeByPAN = await employeeZcql.executeZCQLQuery(
                            `SELECT ROWID FROM Employee WHERE PANNumber = '${panEscaped}'`
                        );
                        console.log('Existing employee by PAN count:', existingEmployeeByPAN.length);
                        employeeExists = existingEmployeeByPAN.length > 0;
                    }
                } catch (qErr) {
                    console.error('Error checking employee by PAN:', qErr);
                }

                if (!employeeExists) {
                    // Parse Phone number safely
                    let phoneNumber = null;
                    if (updatedCandidateRow.Phone) {
                        const phoneStr = String(updatedCandidateRow.Phone).replace(/\D/g, ''); // Remove non-digits
                        if (phoneStr.length > 0) {
                            const parsedPhone = parseInt(phoneStr, 10);
                            if (!isNaN(parsedPhone)) phoneNumber = parsedPhone;
                        }
                    }

                    // Parse Emergency Contact Number safely
                    let emergencyContactNum = null;
                    if (updatedCandidateRow.EmergencyContactNumber) {
                        const emergencyStr = String(updatedCandidateRow.EmergencyContactNumber).replace(/\D/g, '');
                        if (emergencyStr.length > 0) {
                            const parsedEmergency = parseInt(emergencyStr, 10);
                            if (!isNaN(parsedEmergency)) emergencyContactNum = parsedEmergency;
                        }
                    }

                    // Parse education details if available
                    let qualification = null, institutionName = null, fieldOfStudy = null, yearOfCompletion = null, percentageMarks = null;
                    if (updatedCandidateRow.Qualification || updatedCandidateRow.InstitutionName || updatedCandidateRow.FieldofStudy || updatedCandidateRow.YearOfCompletion || updatedCandidateRow.Percent) {
                        qualification = updatedCandidateRow.Qualification || null;
                        institutionName = updatedCandidateRow.InstitutionName || null;
                        fieldOfStudy = updatedCandidateRow.FieldofStudy || updatedCandidateRow.FieldofStudy || null;
                        yearOfCompletion = updatedCandidateRow.YearOfCompletion ? parseInt(updatedCandidateRow.YearOfCompletion, 10) : null;
                        percentageMarks = updatedCandidateRow.Percent || null;
                    }

                    // Normalize ContractorName: trim whitespace to ensure proper matching in employee filter
                    const normalizedContractorName = updatedCandidateRow.ContractorName 
                        ? String(updatedCandidateRow.ContractorName).trim() 
                        : null;
                    
                    console.log('Creating employee - Original ContractorName:', updatedCandidateRow.ContractorName, 'Normalized:', normalizedContractorName);

                    const employeeRow = {
                        EmployeeCode: null, // Leave EmployeeCode blank, don't auto-generate
                        EmployeeName: updatedCandidateRow.CandidateName || '',
                        Personalemailaddress: updatedCandidateRow.Email || '',
                        Phone: phoneNumber,
                        DateofJoining: updatedCandidateRow.DateofEngagement || updatedCandidateRow.DateOfEngagement || null,
                        FathersName: updatedCandidateRow.Fathersname || null,
                        Gender: updatedCandidateRow.Gender || null,
                        BloodGroup: updatedCandidateRow.BloodGroup || null,
                        MaritalStatus: updatedCandidateRow.MaritalStatus || null,
                        EmergencyContactNumber: emergencyContactNum,
                        DateofBirth: updatedCandidateRow.DOB || null,
                        panNumber: updatedCandidateRow.PANNumber ? String(updatedCandidateRow.PANNumber).trim() : null,
                        aadhaarNumber: updatedCandidateRow.AadhaarNumber ? String(updatedCandidateRow.AadhaarNumber).trim() : null,
                        ContractorName: normalizedContractorName,
                        Department: updatedCandidateRow.Department || null,
                        Designation: updatedCandidateRow.Designation || null,
                        ContractorSupervisor: updatedCandidateRow.ContractorSupervisor || null,
                        DrivingLicenseNumber: updatedCandidateRow.DrivingLicenseNumber || null,
                        DrivingLicenseExpiryDate: updatedCandidateRow.DriverLicenseExpiryDate || null,
                        PresentAddressLine1: updatedCandidateRow.PresentAddressLine1 ? String(updatedCandidateRow.PresentAddressLine1).trim() : null,
                        PresentAddressLine2: updatedCandidateRow.PresentAddressLine2 ? String(updatedCandidateRow.PresentAddressLine2).trim() : null,
                        PresentCity: updatedCandidateRow.PresentCity ? String(updatedCandidateRow.PresentCity).trim() : null,
                        PresentState: updatedCandidateRow.PresentState ? String(updatedCandidateRow.PresentState).trim() : null,
                        PresentPostalCode: updatedCandidateRow.PresentPostalCode ? String(updatedCandidateRow.PresentPostalCode).trim() : null,
                        PresentCountry: updatedCandidateRow.PresentCountry ? String(updatedCandidateRow.PresentCountry).trim() : null,
                        PermanentAddressLine1: updatedCandidateRow.PermanentAddressLine1 ? String(updatedCandidateRow.PermanentAddressLine1).trim() : null,
                        PermanentAddressLine2: updatedCandidateRow.PermanentAddressLine2 ? String(updatedCandidateRow.PermanentAddressLine2).trim() : null,
                        PermanentCity: updatedCandidateRow.PermanentCity ? String(updatedCandidateRow.PermanentCity).trim() : null,
                        PermanentState: updatedCandidateRow.PermanentState ? String(updatedCandidateRow.PermanentState).trim() : null,
                        PermanentPostalCode: updatedCandidateRow.PermanentPostalCode ? String(updatedCandidateRow.PermanentPostalCode).trim() : null,
                        PermanentCountry: updatedCandidateRow.PermanentCountry ? String(updatedCandidateRow.PermanentCountry).trim() : null,
                        // Education details (first entry only, can be expanded to JSON if needed)
                        Qualification: qualification,
                        InstitutionName: institutionName,
                        FieldOfStudy: fieldOfStudy,
                        YearOfCompletion: yearOfCompletion,
                        PercentageMarks: percentageMarks,
                        // Set default status
                        employeeStatus: 'Active',
                        Added_User: userEmail || null,
                        Modified_User: userEmail || null
                    };

                    console.log('Attempting to insert employee row (on update):', employeeRow);
                    try {
                        const newEmp = await employeeTable.insertRow(employeeRow);
                        console.log(`Successfully created employee for candidate ${updatedCandidateRow.CandidateName}`, newEmp);
                        console.log(`Employee created for Contractor: ${updatedCandidateRow.ContractorName || 'N/A'}`);
                        employeeCreated = true;
                        employeeCreatedDetails = { newEmp };
                    } catch (insertErr) {
                        console.error('Error inserting new employee row (on update):', insertErr);
                        // Fallback: try minimal insert then update
                        try {
                            // Normalize ContractorName for fallback insert as well
                            const fallbackContractorName = updatedCandidateRow.ContractorName 
                                ? String(updatedCandidateRow.ContractorName).trim() 
                                : null;
                            
                            const minimal = {
                                EmployeeCode: null, // Leave EmployeeCode blank, don't auto-generate
                                EmployeeName: employeeRow.EmployeeName || (updatedCandidateRow.CandidateName || ''),
                                Personalemailaddress: employeeRow.Personalemailaddress || (updatedCandidateRow.Email || null),
                                ContractorName: employeeRow.ContractorName || fallbackContractorName,
                                employeeStatus: 'Active',
                                Added_User: userEmail || null,
                                Modified_User: userEmail || null
                            };
                            console.log('Attempting minimal employee insert (on update):', minimal);
                            const minimalEmp = await employeeTable.insertRow(minimal);
                            console.log('Minimal insert succeeded (on update):', minimalEmp);
                            employeeCreated = true;
                            employeeCreatedDetails = { newEmp: minimalEmp, fallback: 'minimal' };

                            // Attempt to update the record with remaining fields
                            const updateFields = Object.assign({}, employeeRow);
                            delete updateFields.EmployeeCode;
                            delete updateFields.EmployeeName;
                            delete updateFields.Personalemailaddress;
                            delete updateFields.ContractorName;
                            delete updateFields.employeeStatus;
                            delete updateFields.Added_User;
                            delete updateFields.Modified_User;
                            // Remove Skills field as it doesn't exist in Employee table
                            delete updateFields.Skills;
                            updateFields.ROWID = minimalEmp.ROWID;
                            try {
                                const updatedEmp = await employeeTable.updateRow(updateFields);
                                console.log('Updated employee after minimal insert (on update):', updatedEmp);
                                employeeCreatedDetails.updatedEmp = updatedEmp;
                            } catch (updateErr) {
                                console.error('Failed to update employee after minimal insert (on update):', updateErr);
                                employeeCreatedDetails.updateError = updateErr.message || String(updateErr);
                            }
                        } catch (fallbackErr) {
                            console.error('Fallback minimal insert failed (on update):', fallbackErr);
                            employeeCreated = false;
                            employeeCreatedDetails = { reason: 'insert_error', error: insertErr.message || String(insertErr), fallbackError: fallbackErr.message || String(fallbackErr) };
                        }
                    }
                } else {
                    console.log('Employee already exists for this candidate. Updating with candidate data...');
                    
                    // Update existing employee with candidate data to ensure all fields are populated
                    try {
                        let existingEmployeeRowId = null;
                        
                        // Get employee ROWID by email
                        if (updatedCandidateRow?.Email) {
                            const emailEscaped = escapeSQL(updatedCandidateRow.Email.trim());
                            const existingEmployeeByEmail = await employeeZcql.executeZCQLQuery(
                                `SELECT ROWID FROM Employee WHERE Personalemailaddress = '${emailEscaped}'`
                            );
                            if (existingEmployeeByEmail.length > 0) {
                                existingEmployeeRowId = existingEmployeeByEmail[0].Employee?.ROWID || existingEmployeeByEmail[0].ROWID;
                            }
                        }
                        
                        // If not found by email, try by PAN
                        if (!existingEmployeeRowId && updatedCandidateRow?.PANNumber) {
                            const panEscaped = escapeSQL(updatedCandidateRow.PANNumber.trim());
                            const existingEmployeeByPAN = await employeeZcql.executeZCQLQuery(
                                `SELECT ROWID FROM Employee WHERE panNumber = '${panEscaped}'`
                            );
                            if (existingEmployeeByPAN.length > 0) {
                                existingEmployeeRowId = existingEmployeeByPAN[0].Employee?.ROWID || existingEmployeeByPAN[0].ROWID;
                            }
                        }
                        
                        if (existingEmployeeRowId) {
                            console.log(`Found existing employee ROWID: ${existingEmployeeRowId}, updating with candidate data...`);
                            
                            // Build update object with all candidate fields
                            const updateData = {
                                ROWID: existingEmployeeRowId,
                                EmployeeName: updatedCandidateRow.CandidateName || null,
                                Personalemailaddress: updatedCandidateRow.Email || null,
                                Phone: phoneNumber,
                                DateofJoining: updatedCandidateRow.DateofEngagement || updatedCandidateRow.DateOfEngagement || null,
                                FathersName: updatedCandidateRow.Fathersname || null,
                                Gender: updatedCandidateRow.Gender || null,
                                BloodGroup: updatedCandidateRow.BloodGroup || null,
                                MaritalStatus: updatedCandidateRow.MaritalStatus || null,
                                EmergencyContactNumber: emergencyContactNum,
                                DateofBirth: updatedCandidateRow.DOB || null,
                                panNumber: updatedCandidateRow.PANNumber ? String(updatedCandidateRow.PANNumber).trim() : null,
                                aadhaarNumber: updatedCandidateRow.AadhaarNumber ? String(updatedCandidateRow.AadhaarNumber).trim() : null,
                                ContractorName: normalizedContractorName,
                                Department: updatedCandidateRow.Department ? String(updatedCandidateRow.Department).trim() : null,
                                Designation: updatedCandidateRow.Designation ? String(updatedCandidateRow.Designation).trim() : null,
                                ContractorSupervisor: updatedCandidateRow.ContractorSupervisor ? String(updatedCandidateRow.ContractorSupervisor).trim() : null,
                                DrivingLicenseNumber: updatedCandidateRow.DrivingLicenseNumber ? String(updatedCandidateRow.DrivingLicenseNumber).trim() : null,
                                DrivingLicenseExpiryDate: updatedCandidateRow.DriverLicenseExpiryDate ? (typeof updatedCandidateRow.DriverLicenseExpiryDate === 'string' ? updatedCandidateRow.DriverLicenseExpiryDate : String(updatedCandidateRow.DriverLicenseExpiryDate)) : null,
                                PresentAddressLine1: updatedCandidateRow.PresentAddressLine1 ? String(updatedCandidateRow.PresentAddressLine1).trim() : null,
                                PresentAddressLine2: updatedCandidateRow.PresentAddressLine2 ? String(updatedCandidateRow.PresentAddressLine2).trim() : null,
                                PresentCity: updatedCandidateRow.PresentCity ? String(updatedCandidateRow.PresentCity).trim() : null,
                                PresentState: updatedCandidateRow.PresentState ? String(updatedCandidateRow.PresentState).trim() : null,
                                PresentPostalCode: updatedCandidateRow.PresentPostalCode ? String(updatedCandidateRow.PresentPostalCode).trim() : null,
                                PresentCountry: updatedCandidateRow.PresentCountry ? String(updatedCandidateRow.PresentCountry).trim() : null,
                                PermanentAddressLine1: updatedCandidateRow.PermanentAddressLine1 ? String(updatedCandidateRow.PermanentAddressLine1).trim() : null,
                                PermanentAddressLine2: updatedCandidateRow.PermanentAddressLine2 ? String(updatedCandidateRow.PermanentAddressLine2).trim() : null,
                                PermanentCity: updatedCandidateRow.PermanentCity ? String(updatedCandidateRow.PermanentCity).trim() : null,
                                PermanentState: updatedCandidateRow.PermanentState ? String(updatedCandidateRow.PermanentState).trim() : null,
                                PermanentPostalCode: updatedCandidateRow.PermanentPostalCode ? String(updatedCandidateRow.PermanentPostalCode).trim() : null,
                                PermanentCountry: updatedCandidateRow.PermanentCountry ? String(updatedCandidateRow.PermanentCountry).trim() : null,
                                Qualification: qualification,
                                InstitutionName: institutionName,
                                FieldOfStudy: fieldOfStudy,
                                YearOfCompletion: yearOfCompletion,
                                PercentageMarks: percentageMarks,
                                Modified_User: userEmail || null
                            };
                            
                            console.log('Updating existing employee with candidate data:', JSON.stringify(updateData, null, 2));
                            const updatedEmployee = await employeeTable.updateRow(updateData);
                            console.log(`✓ Successfully updated existing employee for candidate: ${updatedCandidateRow.CandidateName}`, updatedEmployee);
                            employeeCreated = true;
                            employeeCreatedDetails = { reason: 'employee_updated', updatedEmployee };
                        } else {
                            console.log('Could not find existing employee ROWID to update.');
                            employeeCreated = false;
                            employeeCreatedDetails = { reason: 'employee_exists_but_rowid_not_found' };
                        }
                    } catch (updateErr) {
                        console.error('Failed to update existing employee with candidate data:', updateErr);
                        console.error('Update error:', updateErr.message);
                        employeeCreated = false;
                        employeeCreatedDetails = { reason: 'update_failed', error: updateErr.message || String(updateErr) };
                    }
                }
            } else {
                console.log('Auto-create Employee logic NOT triggered. ApprovalStatus:', updatedCandidateRow?.ApprovalStatus);
                employeeCreated = false;
                employeeCreatedDetails = { reason: 'not_approved', approvalStatus: updatedCandidateRow?.ApprovalStatus };
            }
        } catch (employeeErr) {
            console.error('Failed to create employee from approved candidate (robust path):', employeeErr);
        }
        // --- End: Auto-create Employee if Approved ---

        res.status(200).send({
            status: 'success',
            data: {
                candidate: {
                    id: candidate.ROWID,
                    ...candidate,
                    fathersName: candidate.Fathersname,
                },
                employeeCreated,
                employeeCreatedDetails
            }
        });
    } catch (err) {
        console.error(`PUT /candidates/${req.params.ROWID} error:`, err);
        const code = err.message.includes('given id does not exist') ? 404 : 500;
        res.status(code).send({ status: 'failure', message: err.message || 'An error occurred while updating the candidate.' });
    }
});

// DELETE API: Delete a candidate by ROWID
app.delete('/candidates/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Candidate');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: {
                candidate: { id: ROWID }
            }
        });
    } catch (err) {
        console.error(`DELETE /candidates/${req.params.ROWID} error:`, err);
        res.status(500).send({ status: 'failure', message: "We're unable to process the request." });
    }
});

// Download file for a candidate
app.get('/candidates/:id/file/photo', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        console.log('Photo download request for candidate ID:', id);

        const result = await zcql.executeZCQLQuery(`SELECT PhotoFileId, Photo FROM Candidate WHERE ROWID = ${id}`);
        console.log('Photo query result:', result);
        
        if (!result || result.length === 0) {
            console.log('No candidate found with ID:', id);
            return res.status(404).send({ status: 'failure', message: 'Candidate not found.' });
        }

        const candidate = result[0].Candidate || result[0].candidate;
        const photoFileId = candidate?.PhotoFileId;
        const photoFileName = candidate?.Photo;

        console.log('Photo data:', { photoFileId, photoFileName });

        if (!photoFileId) {
            console.log('No photo file ID found for candidate:', id);
            return res.status(404).send({ status: 'failure', message: 'Photo not found for this candidate.' });
        }

        const fileStore = catalyst.filestore();
        const folder = fileStore.folder(PHOTO_FOLDER_ID);
        
        console.log('Attempting to download file with ID:', photoFileId, 'from folder:', PHOTO_FOLDER_ID);
        
        const fileBuffer = await folder.downloadFile(photoFileId);
        console.log('File downloaded successfully, size:', fileBuffer.length);

        // Determine content type based on file extension
        let contentType = 'image/jpeg'; // default
        if (photoFileName) {
            const extension = photoFileName.toLowerCase().split('.').pop();
            switch (extension) {
                case 'png':
                    contentType = 'image/png';
                    break;
                case 'gif':
                    contentType = 'image/gif';
                    break;
                case 'webp':
                    contentType = 'image/webp';
                    break;
                default:
                    contentType = 'image/jpeg';
            }
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': fileBuffer.length,
            'Cache-Control': 'no-cache, no-store, must-revalidate', // Disable caching for photos
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(fileBuffer);

    } catch (err) {
        console.error('Download photo error for candidate', req.params.id, ':', err);
        res.status(500).send({ status: 'failure', message: 'Failed to download photo: ' + err.message });
    }
});

// Test endpoint to check photo data for a candidate
app.get('/candidates/:id/photo-info', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        console.log('Photo info request for candidate ID:', id);

        const result = await zcql.executeZCQLQuery(`SELECT PhotoFileId, Photo, ROWID, CandidateName FROM Candidate WHERE ROWID = ${id}`);
        console.log('Photo info query result:', result);
        
        if (!result || result.length === 0) {
            return res.status(404).send({ status: 'failure', message: 'Candidate not found.' });
        }

        const candidate = result[0].Candidate || result[0].candidate;
        
        res.status(200).send({
            status: 'success',
            data: {
                candidateId: id,
                candidateName: candidate?.CandidateName,
                photoFileId: candidate?.PhotoFileId,
                photoFileName: candidate?.Photo,
                hasPhoto: !!(candidate?.PhotoFileId || candidate?.Photo)
            }
        });

    } catch (err) {
        console.error('Photo info error for candidate', req.params.id, ':', err);
        res.status(500).send({ status: 'failure', message: 'Failed to get photo info: ' + err.message });
    }
});

// GET API: Get candidate count
app.get('/candidate/count', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userRole = req.query.userRole; // Get user role from query params
        const userEmail = req.query.userEmail; // Get user email from query params
        const zcql = catalyst.zcql();
        
        console.log('Candidate count request - userRole:', userRole, 'userEmail:', userEmail);

        // Build WHERE clause for contractor filtering
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
                contractorName = null; // Initialize as null
                try {
                    const samuelQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Candidate WHERE ContractorName LIKE '%Samuel%' LIMIT 10`
                    );
                    if (samuelQuery && samuelQuery.length > 0) {
                        // Get the first matching contractor name
                        const firstMatch = samuelQuery[0].Candidate?.ContractorName || samuelQuery[0].candidate?.ContractorName || samuelQuery[0].ContractorName;
                        if (firstMatch) {
                            contractorName = firstMatch;
                            console.log(`[Count] Found Samuel contractor name in database: ${contractorName}`);
                        }
                    }
                } catch (samuelError) {
                    console.log(`[Count] Could not query Samuel contractor name from database: ${samuelError.message}`);
                }
                
                // If no contractor name found, use flexible matching (will match any name containing "Samuel")
                if (!contractorName) {
                    console.log('[Count] No Samuel contractor found in database, will use flexible LIKE matching');
                }
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail.replace(/'/g, "''")}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                    }
                } catch (error) {
                    console.error('Error filtering by contractor:', error);
                }
            }
           
            // Filter candidates by contractor name (case-insensitive)
            // Special handling for Samuel and Sri Balaji users - use flexible matching
            const isSamuelUser = userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com";
            const isSriBalajiUser = userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com";
            
            if (isSamuelUser) {
                // For Samuel users, use exact match with "Samuel Enterprises" since we know it exists
                const escapedSamuelName = 'Samuel Enterprises'.replace(/'/g, "''");
                countWhereClause = `WHERE ContractorName = '${escapedSamuelName}'`;
                console.log(`[Count] Filtering candidate count for Samuel user (exact match): Samuel Enterprises`);
                
                // Debug for count query too
                try {
                    const countDebugQuery = await zcql.executeZCQLQuery(
                        `SELECT COUNT(ROWID) as total FROM Candidate WHERE ContractorName = '${escapedSamuelName}'`
                    );
                    console.log('[Count] Debug - Count query result:', countDebugQuery);
                } catch (countDebugErr) {
                    console.log('[Count] Debug query failed:', countDebugErr.message);
                }
            } else if (isSriBalajiUser) {
                // For Sri Balaji users, first find the exact contractor name in the database
                // to handle spacing variations (e.g., "Sri Balaji Enterprises" vs "Sri  Balaji  Enterprises")
                let exactBalajiName = contractorName || "Sri Balaji Enterprises";
                try {
                    // First, try to find the exact contractor name as stored in the Candidate table
                    const balajiQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Candidate WHERE ContractorName LIKE '%Balaji%' LIMIT 20`
                    );
                    if (balajiQuery && balajiQuery.length > 0) {
                        // Get all matching contractor names
                        const matches = balajiQuery.map(row => 
                            row.Candidate?.ContractorName || row.candidate?.ContractorName || row.ContractorName
                        ).filter(Boolean);
                        
                        // Try to find exact match first (case-insensitive)
                        const exactMatch = matches.find(name => 
                            name.toLowerCase().replace(/\s+/g, ' ') === "Sri Balaji Enterprises".toLowerCase()
                        );
                        exactBalajiName = exactMatch || matches[0] || "Sri Balaji Enterprises";
                        console.log(`[Count] Found Sri Balaji contractor name in database: "${exactBalajiName}" (from ${matches.length} matches)`);
                    } else {
                        console.log('[Count] No Balaji contractor found in database, using default: Sri Balaji Enterprises');
                    }
                } catch (balajiError) {
                    console.log(`[Count] Could not query Sri Balaji contractor name, using default: ${balajiError.message}`);
                }
                
                // Use exact match with the found contractor name (more reliable than LIKE)
                const escapedBalajiName = exactBalajiName.replace(/'/g, "''");
                
                // First verify the exact match works, if not fall back to LIKE pattern
                try {
                    const countDebugQuery = await zcql.executeZCQLQuery(
                        `SELECT COUNT(ROWID) as total FROM Candidate WHERE ContractorName = '${escapedBalajiName}'`
                    );
                    const countValue = countDebugQuery[0]?.Candidate?.total || countDebugQuery[0]?.candidate?.total || countDebugQuery[0]?.total || 0;
                    console.log(`[Count] Debug - Count query with exact match "${exactBalajiName}" returned: ${countValue}`);
                    
                    if (countValue > 0) {
                        // Use exact match since it works
                        countWhereClause = `WHERE ContractorName = '${escapedBalajiName}'`;
                        console.log(`[Count] Filtering candidate count for Sri Balaji user (exact match): "${exactBalajiName}"`);
                    } else {
                        // If exact match returns 0, try LIKE as fallback
                        console.log('[Count] Exact match returned 0, trying LIKE fallback...');
                        const patternWords = normalizeName(exactBalajiName).split(' ').filter(w => w.length > 0);
                        const pattern = patternWords.join('%');
                        const likeCountQuery = await zcql.executeZCQLQuery(
                            `SELECT COUNT(ROWID) as total FROM Candidate WHERE ContractorName LIKE '%${pattern}%'`
                        );
                        const likeCount = likeCountQuery[0]?.Candidate?.total || likeCountQuery[0]?.candidate?.total || likeCountQuery[0]?.total || 0;
                        console.log(`[Count] LIKE pattern '%${pattern}%' returned count: ${likeCount}`);
                        if (likeCount > 0) {
                            // Use LIKE pattern instead
                            countWhereClause = `WHERE ContractorName LIKE '%${pattern}%'`;
                            console.log(`[Count] Switched to LIKE pattern for Sri Balaji: "%${pattern}%"`);
                        } else {
                            // Fallback to simple LIKE if pattern doesn't work
                            countWhereClause = `WHERE ContractorName LIKE '%Balaji%'`;
                            console.log('[Count] Using simple LIKE fallback: "%Balaji%"');
                        }
                    }
                } catch (countDebugErr) {
                    console.log('[Count] Debug query failed, using LIKE pattern as fallback:', countDebugErr.message);
                    // Fallback to LIKE pattern if test query fails
                    const patternWords = normalizeName(exactBalajiName).split(' ').filter(w => w.length > 0);
                    const pattern = patternWords.join('%');
                    countWhereClause = `WHERE ContractorName LIKE '%${pattern}%'`;
                    console.log(`[Count] Filtering candidate count for Sri Balaji user (LIKE pattern fallback): "%${pattern}%"`);
                }
            } else if (contractorName) {
                const escapedContractorName = contractorName.replace(/'/g, "''");
                
                // First, try to get the exact contractor name as stored in the Candidate table
                // This handles case variations
                let exactContractorName = contractorName;
                try {
                    // Build a LIKE pattern from normalized words in contractor name (collapses multiple spaces)
                    const words = normalizeName(contractorName).split(' ').filter(w => w.length > 0);
                    const pattern = words.join('%');
                    const contractorNameQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Candidate WHERE ContractorName LIKE '%${pattern}%' LIMIT 20`
                    );
                    if (contractorNameQuery && contractorNameQuery.length > 0) {
                        // Find the best match (exact match if available, otherwise first match)
                        const matches = contractorNameQuery.map(row => row.Candidate?.ContractorName || row.candidate?.ContractorName).filter(Boolean);
                        const exactMatch = matches.find(name => name.toLowerCase() === contractorName.toLowerCase());
                        exactContractorName = exactMatch || matches[0] || contractorName;
                        console.log(`[Count] Found contractor name in database: ${exactContractorName} (searched for: ${contractorName})`);
                    }
                } catch (nameError) {
                    console.log(`[Count] Could not query exact contractor name, using provided name: ${contractorName}. Error: ${nameError.message}`);
                }
                
                // Escape the exact contractor name
                const escapedExactName = exactContractorName.replace(/'/g, "''");
                
                // Use exact match with the contractor name as stored in database
                countWhereClause = `WHERE ContractorName = '${escapedExactName}'`;
                console.log(`[Count] Filtering candidate count for contractor (exact match): ${exactContractorName}`);
            } else {
                // If no contractor found, return 0 for App Users
                console.log(`No contractor found for user ${userEmail}, returning count 0`);
                return res.json({ count: 0 });
            }
        }

        // For App Administrator or after filtering setup, get total count
        if (userRole !== 'App User' || !userEmail) {
            console.log('App Administrator or no user email - getting total count');
        }
        
        // Get count with contractor filter
        const countQuery = `SELECT COUNT(ROWID) as count FROM Candidate ${countWhereClause}`;
        console.log('Executing count query:', countQuery);
        
        let countResult;
        try {
            countResult = await zcql.executeZCQLQuery(countQuery);
            console.log('Raw count result:', countResult);
            console.log('Count result type:', typeof countResult);
            console.log('Count result length:', countResult ? countResult.length : 'null');
            
            if (countResult && countResult.length > 0) {
                console.log('First result item:', countResult[0]);
                console.log('First result keys:', Object.keys(countResult[0]));
                if (countResult[0].Candidate) {
                    console.log('Candidate object keys:', Object.keys(countResult[0].Candidate));
                }
            }
        } catch (queryError) {
            console.error('Count query failed:', queryError);
            countResult = null;
            // Try a simpler query to tes
            try {
                const testQuery = `SELECT ROWID FROM Candidate LIMIT 1`;
                console.log('Trying test query:', testQuery);
                const testResult = await zcql.executeZCQLQuery(testQuery);
                console.log('Test query result:', testResult);
            } catch (testError) {
                console.error('Test query also failed:', testError);
            }
        }
        
        let count = 0;
        
        // Try to get count from the main query result
        if (countResult && countResult.length > 0 && countResult[0].Candidate) {
            // The result structure shows 'COUNT(ROWID)' not 'count'
            count = parseInt(countResult[0].Candidate['COUNT(ROWID)']) || 0;
            console.log('Count from main query:', count);
        }
        
        // If count is still 0, try alternative approaches
        if (count === 0) {
            console.log('Count is 0, trying alternative approaches...');
            
            // Try different count queries
            const alternativeQueries = [
                `SELECT COUNT(ROWID) as count FROM Candidate`,
                `SELECT COUNT(CandidateName) as count FROM Candidate`,
                `SELECT COUNT(Email) as count FROM Candidate`
            ];
            
            for (let i = 0; i < alternativeQueries.length; i++) {
                try {
                    console.log(`Trying alternative query ${i + 1}:`, alternativeQueries[i]);
                    const altResult = await zcql.executeZCQLQuery(alternativeQueries[i]);
                    console.log(`Alternative query ${i + 1} result:`, altResult);
                    
                    if (altResult && altResult.length > 0 && altResult[0].Candidate) {
                        // Check for different possible column names
                        const possibleKeys = Object.keys(altResult[0].Candidate);
                        console.log(`Alternative query ${i + 1} keys:`, possibleKeys);
                        
                        for (const key of possibleKeys) {
                            if (key.includes('COUNT')) {
                                count = parseInt(altResult[0].Candidate[key]) || 0;
                                console.log(`Count from alternative query ${i + 1} using key '${key}':`, count);
                                if (count > 0) break;
                            }
                        }
                        if (count > 0) break;
                    }
                } catch (altErr) {
                    console.error(`Alternative query ${i + 1} failed:`, altErr);
                }
            }
        }
        
        console.log('Final candidate count:', count);
        
        const response = { count: count };
        console.log('Sending response:', response);
        res.json(response);
    } catch (err) {
        console.error('GET /candidate/count error:', err);
        res.status(500).json({ error: 'Failed to get candidate count' });
    }
});

// Debug endpoint: Check Employee records by email (temporary, helps troubleshooting auto-create)
app.get('/candidates/check-employee/:email', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const email = req.params.email;
        console.log('Checking employee by email:', email);
        const escaped = email.replace(/'/g, "''");
        const result = await zcql.executeZCQLQuery(`SELECT ROWID, EmployeeName, Personalemailaddress, ContractorName FROM Employee WHERE LOWER(Personalemailaddress) = LOWER('${escaped}')`);
        console.log('Check employee result:', result);
        res.status(200).send({ status: 'success', data: result });
    } catch (err) {
        console.error('Error checking employee by email:', err);
        res.status(500).send({ status: 'failure', message: err.message || 'Error checking employee' });
    }
});

module.exports = app;