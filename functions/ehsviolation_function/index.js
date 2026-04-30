'use strict';

const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const app = express();
// Ensure fileUpload runs before JSON parser so multipart isn't interfered with
app.use(fileUpload());
app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Folder mapping for EHS Violation files in Catalyst FileStore
// Updated to match File Store folder "EHSFileupload" shown in the console
const EHS_VIOLATION_FOLDER_ID = '21320000000094915';

// GET API: Get all violations (with optional pagination and filtering)
app.get('/violations', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { employeeId } = req.query;
        const userRole = req.query.userRole; // Get user role from query params
        const userEmail = req.query.userEmail; // Get user email from query params
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        
        console.log('EHS Violations fetch request:', { employeeId, userRole, userEmail, page, perPage });
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(200).send({
                status: 'success',
                data: {
                    violations: [],
                    hasMore: false,
                    total: 0
                }
            });
        }

        const allRows = await table.getAllRows();
        console.log(`Found ${allRows.length} violations in database`);
        
        let filteredViolations = allRows;
        
        // Filter by contractor if user is App User (contractor)
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;
            const zcql = catalyst.zcql();
           
            // Check hardcoded mappings (same as candidate function)
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                try {
                    const samuelQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT Contractor FROM EHSViolation WHERE Contractor LIKE '%Samuel%' LIMIT 10`
                    );
                    if (samuelQuery && samuelQuery.length > 0) {
                        contractorName = samuelQuery[0].EHSViolation?.Contractor || samuelQuery[0].ehsviolation?.Contractor || "Samuel Enterprises";
                    } else {
                        contractorName = "Samuel Enterprises";
                    }
                } catch (samuelError) {
                    contractorName = "Samuel Enterprises";
                }
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email from Contractors table
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
           
            // Filter violations by contractor name
            if (contractorName) {
                // Try to find exact contractor name as stored in the database
                let exactContractorName = contractorName;
                try {
                    const contractorNameQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT Contractor FROM EHSViolation WHERE Contractor LIKE '%${contractorName.replace(/\s+/g, '%')}%' LIMIT 20`
                    );
                    if (contractorNameQuery && contractorNameQuery.length > 0) {
                        const matches = contractorNameQuery.map(row => row.EHSViolation?.Contractor || row.ehsviolation?.Contractor).filter(Boolean);
                        const exactMatch = matches.find(name => name && name.toLowerCase() === contractorName.toLowerCase());
                        exactContractorName = exactMatch || matches[0] || contractorName;
                        console.log(`Found contractor name in database: ${exactContractorName} (searched for: ${contractorName})`);
                    }
                } catch (nameError) {
                    console.log(`Could not query exact contractor name, using provided name: ${contractorName}`);
                }
                
                // Filter by exact contractor name (case-sensitive match with database value)
                filteredViolations = filteredViolations.filter(v => {
                    const violationContractor = v.Contractor;
                    if (!violationContractor) return false;
                    // Use exact match (since we got the exact name from database)
                    return violationContractor === exactContractorName;
                });
                console.log(`Filtered to ${filteredViolations.length} violations for contractor: ${exactContractorName}`);
            } else {
                // If no contractor found, don't show any violations for App Users
                console.log(`No contractor found for user ${userEmail}, showing no violations`);
                filteredViolations = [];
            }
        }
        
        // Filter by employeeId if provided (after contractor filtering)
        if (employeeId) {
            filteredViolations = filteredViolations.filter(v => 
                v.ContractEmployeeID === employeeId
            );
            console.log(`Filtered to ${filteredViolations.length} violations for employee ${employeeId}`);
        }
        
        const total = filteredViolations.length;
        const violations = filteredViolations
            .slice((page - 1) * perPage, page * perPage)
            .map(row => ({
                id: row.ROWID,
                ...row
            }));

        res.status(200).send({
            status: 'success',
            data: {
                violations,
                total,
                hasMore: page * perPage < total
            }
        });
    } catch (err) {
        console.error('GET /violations error:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request.",
            error: err.message
        });
    }
});

// GET API: Get a specific violation by ID
app.get('/violations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(404).send({
                status: 'failure',
                message: 'Violation not found'
            });
        }
        
        const violation = await table.getRow(id);
        
        if (!violation) {
            return res.status(404).send({
                status: 'failure',
                message: 'Violation not found'
            });
        }
        
        res.status(200).send({
            status: 'success',
            data: { violation }
        });
    } catch (err) {
        console.error('GET /violations/:id error:', err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Create a new violation
app.post('/violations', async (req, res) => {
    try {
        const body = req.body;
        const { catalyst } = res.locals;
        
        console.log('Creating new violation with data:', body);
        
        // Validate required fields
        if (!body.ContractEmployeeID || !body.Stage1) {
            return res.status(400).send({
                status: 'failure',
                message: 'Contract Employee ID and Stage 1 are required.'
            });
        }
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'EHSViolation table does not exist. Please create the EHSViolation table in your Catalyst datastore with the required columns.',
                error: tableError.message
            });
        }

        // Determine contractor name - use from body if provided, otherwise try to get from user email
        let contractorName = body.Contractor || null;
        
        // If contractor not provided, try to get from userEmail in request body or query
        if (!contractorName && (body.userEmail || req.query.userEmail)) {
            const userEmail = body.userEmail || req.query.userEmail;
            const zcql = catalyst.zcql();
            
            // Check hardcoded mappings (same as GET endpoint)
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                try {
                    const samuelQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT Contractor FROM EHSViolation WHERE Contractor LIKE '%Samuel%' LIMIT 10`
                    );
                    if (samuelQuery && samuelQuery.length > 0) {
                        contractorName = samuelQuery[0].EHSViolation?.Contractor || samuelQuery[0].ehsviolation?.Contractor || "Samuel Enterprises";
                    } else {
                        contractorName = "Samuel Enterprises";
                    }
                } catch (samuelError) {
                    contractorName = "Samuel Enterprises";
                }
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // For other App Users, try to find contractor by email from Contractors table
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail.replace(/'/g, "''")}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                    }
                } catch (error) {
                    console.error('Error finding contractor by email:', error);
                }
            }
            
            if (contractorName) {
                console.log(`Auto-set Contractor to: ${contractorName} for user: ${userEmail}`);
            }
        }

        const payload = {
            Contractor: contractorName,
            ContractEmployeeID: body.ContractEmployeeID,
            DateofViolation: body.DateofViolation || null,
            TypeofViolation: body.TypeofViolation || null,
            Safetyviolationchallannumber: body.Safetyviolationchallannumber || null,
            Stage1: body.Stage1,
            Stage2: body.Stage2 || null,
            Stage3: body.Stage3 || null,
            FileUpload: body.FileUpload || null
        };

        console.log('Saving violation with payload:', payload);
        
        const { ROWID: id } = await table.insertRow(payload);

        res.status(201).send({
            status: 'success',
            data: {
                violation: { id, ...payload }
            }
        });
    } catch (err) {
        console.error('POST /violations error:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to create violation.',
            error: err.message
        });
    }
});

// PUT API: Update a violation
app.put('/violations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;
        const { catalyst } = res.locals;
        
        console.log('Updating violation', id, 'with data:', body);
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'EHSViolation table does not exist.' 
            });
        }

        // User management removed since audit fields don't exist in datastore schema

        // Get existing violation
        const existingViolation = await table.getRow(id);
        if (!existingViolation) {
            return res.status(404).send({
                status: 'failure',
                message: 'Violation not found'
            });
        }

        const payload = {
            ROWID: id,
            Contractor: body.Contractor || existingViolation.Contractor,
            ContractEmployeeID: body.ContractEmployeeID || existingViolation.ContractEmployeeID,
            DateofViolation: body.DateofViolation || existingViolation.DateofViolation,
            TypeofViolation: body.TypeofViolation || existingViolation.TypeofViolation,
            Safetyviolationchallannumber: body.Safetyviolationchallannumber || existingViolation.Safetyviolationchallannumber,
            Stage1: body.Stage1 || existingViolation.Stage1,
            Stage2: body.Stage2 || existingViolation.Stage2,
            Stage3: body.Stage3 || existingViolation.Stage3,
            FileUpload: body.FileUpload || existingViolation.FileUpload
        };

        console.log('Updating violation with payload:', payload);
        
        const updatedViolation = await table.updateRow(payload);

        res.status(200).send({
            status: 'success',
            data: {
                violation: updatedViolation
            }
        });
    } catch (err) {
        console.error('PUT /violations/:id error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to update violation.'
        });
    }
});

// DELETE API: Delete a violation
app.delete('/violations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        
        console.log('Deleting violation:', id);
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'EHSViolation table does not exist.' 
            });
        }

        await table.deleteRow(id);

        res.status(200).send({
            status: 'success',
            message: 'Violation deleted successfully'
        });
    } catch (err) {
        console.error('DELETE /violations/:id error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to delete violation.'
        });
    }
});

// POST API: Upload file for a violation
app.post('/violations/:id/upload/:field', async (req, res) => {
    try {
        const { id, field } = req.params;
        const { catalyst } = res.locals;
        
        console.log('Uploading file for violation', id, 'field:', field);
        
        // Normalize supported field names: allow both FileUpload and EHSFileName
        const supportedFields = new Set(['FileUpload', 'EHSFileName']);
        const requestedField = supportedFields.has(field) ? field : 'EHSFileName';

        // Check if file was uploaded
        if (!req.files || !req.files.file) {
            console.error('No file uploaded for violation id:', id, 'field:', field);
            return res.status(400).send({
                status: 'failure',
                message: 'No file uploaded'
            });
        }

        const file = req.files.file;
        console.log('File received:', { name: file.name, size: file.size, type: file.mimetype });
        
        // Validate file size (5MB = 5 * 1024 * 1024 bytes)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            console.error('File too large:', file.size, 'bytes for file:', file.name);
            return res.status(413).send({
                status: 'failure',
                message: `File size exceeds 5MB limit. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`
            });
        }
        
        // Validate file type
        const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (!allowedTypes.includes(ext)) {
            console.error('Invalid file type:', ext, 'for file:', file.name);
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid file type. Only PDF, JPG, JPEG, PNG, DOC, and DOCX files are allowed.'
            });
        }
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'EHSViolation table does not exist.' 
            });
        }

        // Check if violation exists
        const violation = await table.getRow(id);
        if (!violation) {
            return res.status(404).send({
                status: 'failure',
                message: 'Violation not found'
            });
        }

        // Pick a safe target column based on what's available in the row
        let targetField = requestedField;
        const rowHasRequested = Object.prototype.hasOwnProperty.call(violation, requestedField);
        const rowHasEHSFileName = Object.prototype.hasOwnProperty.call(violation, 'EHSFileName');
        const rowHasFileUpload = Object.prototype.hasOwnProperty.call(violation, 'FileUpload');
        if (!rowHasRequested) {
            if (rowHasEHSFileName) targetField = 'EHSFileName';
            else if (rowHasFileUpload) targetField = 'FileUpload';
            else targetField = 'FileUpload';
        }

        // Upload file to Catalyst FileStore
        const tempPath = `/tmp/${file.name}`;
        await file.mv(tempPath);
        
        try {
            const uploadResp = await catalyst.filestore().folder(EHS_VIOLATION_FOLDER_ID).uploadFile({
                code: fs.createReadStream(tempPath),
                name: file.name
            });

            console.log('File upload response:', uploadResp);

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
                console.error('Unexpected upload response:', uploadResp);
                throw new Error('File upload failed or invalid response from Catalyst.');
            }

            // Clean up temporary file
            fs.unlinkSync(tempPath);
            console.log('Temporary file cleaned up');

            // Create file info object
            const fileInfo = {
                fileId: fileId.toString(),
                fileName: fileName,
                uploadedAt: new Date().toISOString()
            };

            // Update the violation with file info
            const updatePayload = {
                ROWID: id,
                [targetField]: JSON.stringify(fileInfo)
            };

            await table.updateRow(updatePayload);

            console.log('File upload successful. FileId:', fileId, 'FileName:', fileName);

            res.status(200).send({
                status: 'success',
                data: { fileInfo, field: targetField }
            });
        } catch (uploadError) {
            // Clean up temporary file in case of error
            try {
                fs.unlinkSync(tempPath);
            } catch (cleanupError) {
                console.error('Failed to clean up temp file:', cleanupError);
            }
            throw uploadError;
        }
    } catch (err) {
        console.error('POST /violations/:id/upload/:field error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to upload file.'
        });
    }
});

// GET API: Download file for a violation
app.get('/violations/:id/file/:field', async (req, res) => {
    try {
        const { id, field } = req.params;
        const { catalyst } = res.locals;
        
        console.log('Downloading file for violation', id, 'field:', field);
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'EHSViolation table does not exist.' 
            });
        }

        // Get violation
        const violation = await table.getRow(id);
        if (!violation) {
            return res.status(404).send({
                status: 'failure',
                message: 'Violation not found'
            });
        }

        // Try the requested field first, then gracefully fall back to the other
        const primaryField = field;
        const secondaryField = field === 'EHSFileName' ? 'FileUpload' : 'EHSFileName';
        const fileData = violation[primaryField] || violation[secondaryField];
        if (!fileData) {
            return res.status(404).send({
                status: 'failure',
                message: 'File not found'
            });
        }

        try {
            const fileInfo = JSON.parse(fileData);
            const fileId = fileInfo.fileId;
            const fileName = fileInfo.fileName || 'downloaded_file';
            
            if (!fileId) {
                return res.status(404).send({
                    status: 'failure',
                    message: 'File ID not found'
                });
            }

            // Download file from Catalyst FileStore
            const fileBuffer = await catalyst.filestore().folder(EHS_VIOLATION_FOLDER_ID).downloadFile(fileId);
            
            res.writeHead(200, {
                'Content-Length': fileBuffer.length,
                'Content-Disposition': `attachment; filename="${fileName}"`,
            });
            res.end(fileBuffer);
        } catch (error) {
            console.error('Error processing file data:', error);
            res.status(400).send({
                status: 'failure',
                message: 'Invalid file data or file not found in storage'
            });
        }
    } catch (err) {
        console.error('GET /violations/:id/file/:field error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to download file.'
        });
    }
});

// Debug endpoint to check EHSViolation table structure
app.get('/debug-violations', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        
        // Try to get the EHSViolation table
        let table;
        try {
            table = catalyst.datastore().table('EHSViolation');
        } catch (tableError) {
            console.error('EHSViolation table not found:', tableError);
            return res.status(200).send({
                status: 'success',
                data: {
                    tableExists: false,
                    message: 'EHSViolation table does not exist. Please create it in your Catalyst datastore.',
                    error: tableError.message,
                    requiredColumns: [
                        'Contractor', 'ContractEmployeeID', 'DateofViolation', 'TypeofViolation',
                        'Safetyviolationchallannumber', 'Stage1', 'FileUpload', 'Stage2', 'Stage3'
                    ]
                }
            });
        }

        const allRows = await table.getAllRows();
        
        res.status(200).send({
            status: 'success',
            data: {
                tableExists: true,
                totalViolations: allRows.length,
                sampleViolations: allRows.slice(0, 3).map(row => ({
                    id: row.ROWID,
                    ContractEmployeeID: row.ContractEmployeeID,
                    Stage1: row.Stage1,
                    Stage2: row.Stage2,
                    Stage3: row.Stage3
                }))
            }
        });
    } catch (err) {
        console.error('Debug violations error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Error fetching debug data',
            error: err.message
        });
    }
});

// New endpoint to create the EHSViolation table
app.post('/create-table', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        
        console.log('Attempting to create EHSViolation table...');
        
        // Define the table schema
        const tableSchema = {
            tableName: 'EHSViolation',
            columns: [
                {
                    columnName: 'Contractor',
                    dataType: 'TEXT',
                    maxLength: 255
                },
                {
                    columnName: 'ContractEmployeeID',
                    dataType: 'TEXT',
                    maxLength: 255
                },
                {
                    columnName: 'DateofViolation',
                    dataType: 'DATE'
                },
                {
                    columnName: 'TypeofViolation',
                    dataType: 'TEXT',
                    maxLength: 50
                },
                {
                    columnName: 'Safetyviolationchallannumber',
                    dataType: 'TEXT',
                    maxLength: 255
                },
                {
                    columnName: 'Stage1',
                    dataType: 'TEXT',
                    maxLength: 1000
                },
                {
                    columnName: 'Stage2',
                    dataType: 'TEXT',
                    maxLength: 1000
                },
                {
                    columnName: 'Stage3',
                    dataType: 'TEXT',
                    maxLength: 1000
                },
                {
                    columnName: 'FileUpload',
                    dataType: 'TEXT',
                    maxLength: 1000
                }
            ]
        };
        
        // Create the table
        const table = await datastore.createTable(tableSchema);
        
        console.log('EHSViolation table created successfully:', table);
        
        res.status(200).send({
            status: 'success',
            message: 'EHSViolation table created successfully',
            data: {
                tableName: table.tableName,
                tableId: table.tableId
            }
        });
    } catch (err) {
        console.error('Create table error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Failed to create table',
            error: err.message
        });
    }
});

// New endpoint to check all available tables
app.get('/debug-tables', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        
        console.log('Checking available tables...');
        
        // Get all tables
        const tables = await datastore.getAllTables();
        
        console.log('Available tables:', tables);
        
        res.status(200).send({
            status: 'success',
            data: {
                totalTables: tables.length,
                tables: tables.map(table => ({
                    tableName: table.tableName,
                    tableId: table.tableId
                }))
            }
        });
    } catch (err) {
        console.error('Debug tables error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || 'Error fetching tables',
            error: err.message
        });
    }
});

module.exports = app;
