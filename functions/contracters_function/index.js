'use strict';

const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
}));
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Health check endpoint to verify function is running updated code
app.get('/health', (req, res) => {
    res.status(200).send({
        status: 'success',
        message: 'Contracter function is running updated code',
        timestamp: new Date().toISOString(),
        version: 'v3.0-clean-upload'
    });
});



function cleanDate(value) {
    if (!value || value === '') return null;
    return value;
}

// GET API: Get all contractors (with optional pagination)
app.get('/contractors', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const table = catalyst.datastore().table('Contractors');

        const allRows = await table.getAllRows();
        console.log('Fetched rows:', allRows.length, allRows[0]);
        const total = allRows.length;
        const contractors = allRows
            .slice((page - 1) * perPage, page * perPage)
            .map(row => ({
                id: row.ROWID,
                ...row
            }));

        res.status(200).send({
            status: 'success',
            data: {
                contractors,
                hasMore: page * perPage < total
            }
        });
    } catch (err) {
        console.log('GET /contractors error:', err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new contractor
app.post('/contractors', async (req, res) => {
    try {
        const body = req.body;
        console.log('Creating new contractor with data:', body);
        
        // Validate mandatory fields
        if (!body.Organization || !body.ContractorName || !body.PrimaryEmail || !body.PrimaryMobileNo || !body.EstablishmentName || !body.EstablishmentShortName) {
            return res.status(400).send({
                status: 'failure',
                message: 'Organization, Contractor Name, Primary Email, Primary Mobile No., Establishment Name, and Establishment Short Name are required.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Contractors');
        
        // Prepare the payload with file information
        const payload = {
            ...body,
            ContractStartDate: cleanDate(body.ContractStartDate),
            ContractEndDate: cleanDate(body.ContractEndDate),
            ContractvalidFrom: cleanDate(body.ContractvalidFrom),
            ContractValidTo: cleanDate(body.ContractValidTo),
        };

        // File fields are already in the correct format (FileId/FileName)
        // Just ensure they are strings and remove any legacy fields
        const fileFields = [
            'OrganizationPANFileId', 'OrganizationPANFileName',
            'GSTRegistartionCertificateFileId', 'GSTRegistartionCertificateFileName',
            'PFRegistrationCertificateFileId', 'PFRegistrationCertificateFileName',
            'ESIRegistrationcertificateFileId', 'ESIRegistrationcertificateFileName',
            'ContractorPANFileId', 'ContractorPANFileName',
            'ContractorAadharFileId', 'ContractorAadharFileName'
        ];
        
        // Remove legacy document fields that might cause invalid column errors
        ['OrganizationPAN', 'GSTRegistartionCertificate', 'PFRegistrationCertificate', 'ESIRegistrationcertificate', 'ContractorPAN', 'ContractorAadhar']
            .forEach(legacy => {
                if (legacy in payload) delete payload[legacy];
            });
        
        // Log the file information being stored
        console.log('File information to be stored for creation:');
        fileFields.forEach(field => {
            if (payload[field]) {
                console.log(`${field}: ${payload[field]}`);
            }
        });
        
        // Also log all payload keys to see what's being sent
        console.log('All payload keys:', Object.keys(payload));
        
        console.log('Attempting to insert contractor with payload:', payload);
        const { ROWID: id } = await table.insertRow(payload);
        console.log('Contractor created successfully with ID:', id);
        
        res.status(200).send({
            status: 'success',
            data: { contractor: { id, ...payload } }
        });
    } catch (err) {
        console.error('Error creating contractor:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});



// PUT API: Update a contractor by ROWID
app.put('/contractors/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const body = req.body;
        console.log('Updating contractor with data:', body);
        
        // Validate mandatory fields
        if (!body.Organization || !body.ContractorName || !body.PrimaryEmail || !body.PrimaryMobileNo || !body.EstablishmentName || !body.EstablishmentShortName) {
            return res.status(400).send({
                status: 'failure',
                message: 'Organization, Contractor Name, Primary Email, Primary Mobile No., Establishment Name, and Establishment Short Name are required.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Contractors');
        
        // Prepare the payload with file information
        const payload = {
            ...body,
            ContractStartDate: cleanDate(body.ContractStartDate),
            ContractEndDate: cleanDate(body.ContractEndDate),
            ContractvalidFrom: cleanDate(body.ContractvalidFrom),
            ContractValidTo: cleanDate(body.ContractValidTo),
        };

        // File fields are already in the correct format (FileId/FileName)
        // Just ensure they are strings and remove any legacy fields
        const fileFields = [
            'OrganizationPANFileId', 'OrganizationPANFileName',
            'GSTRegistartionCertificateFileId', 'GSTRegistartionCertificateFileName',
            'PFRegistrationCertificateFileId', 'PFRegistrationCertificateFileName',
            'ESIRegistrationcertificateFileId', 'ESIRegistrationcertificateFileName',
            'ContractorPANFileId', 'ContractorPANFileName',
            'ContractorAadharFileId', 'ContractorAadharFileName'
        ];
        
        // Remove legacy document fields that might cause invalid column errors
        ['OrganizationPAN', 'GSTRegistartionCertificate', 'PFRegistrationCertificate', 'ESIRegistrationcertificate', 'ContractorPAN', 'ContractorAadhar']
            .forEach(legacy => {
                if (legacy in payload) delete payload[legacy];
            });
        
        console.log('File information to be stored for update:');
        fileFields.forEach(field => {
            if (payload[field]) {
                console.log(`${field}: ${payload[field]}`);
            }
        });
        
        const updatedRow = await table.updateRow({ ROWID, ...payload });
        console.log('Contractor updated successfully with ID:', ROWID);
        
        res.status(200).send({
            status: 'success',
            data: { contractor: { id: ROWID, ...payload } }
        });
    } catch (err) {
        console.error('Error updating contractor:', err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// DELETE API: Delete a contractor by ROWID
app.delete('/contractors/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Contractors');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: { contractor: { id: ROWID } }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// GET API: Get all organizations (with optional pagination)
app.get('/organizations', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const table = catalyst.datastore().table('Organization');

        const allRows = await table.getAllRows();
        console.log('Fetched organization rows:', allRows.length, allRows[0]);
        const total = allRows.length;
        const organizations = allRows
            .slice((page - 1) * perPage, page * perPage)
            .map(row => ({
                id: row.ROWID,
                ...row
            }));

        res.status(200).send({
            status: 'success',
            data: {
                organizations,
                hasMore: page * perPage < total
            }
        });
    } catch (err) {
        console.log('GET /organizations error:', err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new organization
app.post('/organizations', async (req, res) => {
    try {
        const body = req.body;
        // Validate mandatory fields (customize as per your schema)
        if (!body.OrganizationName) {
            return res.status(400).send({
                status: 'failure',
                message: 'Organization Name is required.'
            });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Organization');
        const payload = Object.fromEntries(
            Object.entries(body).filter(([key]) => allowedFields.includes(key))
        );
        const { ROWID: id } = await table.insertRow(payload);
        res.status(200).send({
            status: 'success',
            data: { organization: { id, ...body } }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// PUT API: Update an organization by ROWID
app.put('/organizations/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const body = req.body;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Organization');
        const payload = Object.fromEntries(
            Object.entries(body).filter(([key]) => allowedFields.includes(key))
        );
        const updatedRow = await table.updateRow({ ROWID, ...payload });
        res.status(200).send({
            status: 'success',
            data: { organization: { id: updatedRow.ROWID, ...body } }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// DELETE API: Delete an organization by ROWID
app.delete('/organizations/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Organization');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: { organization: { id: ROWID } }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// GET API: Get contractor count (filtered for App Users)
app.get('/contractors/count', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userRole = req.query.userRole;
        const userEmail = req.query.userEmail;

        const table = catalyst.datastore().table('Contractors');
        const allRows = await table.getAllRows();

        // If App User, try to filter to their contractor only
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;

            // Hardcoded mappings used elsewhere in the app
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                contractorName = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                contractorName = "Yashaswi Academy for Skills";
            } else {
                // Fallback: find by PrimaryEmail
                const match = allRows.find(row => (row.PrimaryEmail || '').toLowerCase() === userEmail.toLowerCase());
                if (match) {
                    contractorName = match.ContractorName || match.OrganizationName || null;
                }
            }

            if (contractorName) {
                const filtered = allRows.filter(row =>
                    (row.ContractorName || row.OrganizationName || '').toLowerCase() === contractorName.toLowerCase()
                );
                return res.json({ count: filtered.length });
            }
        }

        // Default: return total count
        res.json({ count: allRows.length });
    } catch (err) {
        console.error('Contractor count error:', err);
        res.status(500).json({ error: 'Failed to get contractor count' });
    }
});

// GET API: Get contractor performance scoring data
app.get('/contractor-performance', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
        
        console.log('Contractor performance request:', { userEmail, userRole });
        
        // Try to get the ContractorPerformance table first
        let performanceTable;
        try {
            performanceTable = catalyst.datastore().table('ContractorPerformance');
            console.log('Found ContractorPerformance table, fetching data...');
            
            // Get all employees to recalculate active employee counts
            const employeeTable = catalyst.datastore().table('Employee');
            const allEmployees = await employeeTable.getAllRows();
            console.log('Total employees found for active count calculation:', allEmployees.length);
            
            const allPerformanceRows = await performanceTable.getAllRows();
            const performanceData = allPerformanceRows.map(row => {
                const contractorName = row.ContractorName;
                
                // Recalculate active employee count for this contractor
                const activeEmployeeCount = allEmployees.filter(emp => {
                    // Filter by active status first
                    const empStatus = emp.employeeStatus || emp.EmployeeStatus || '';
                    const isActive = empStatus === 'Active';
                    if (!isActive) return false;
                    
                    const empContractor = emp.ContractorName || emp.contractor || '';
                    const contractorNameLower = contractorName.toLowerCase().trim();
                    const empContractorLower = empContractor.toString().toLowerCase().trim();
                    
                    return empContractorLower === contractorNameLower ||
                           empContractorLower.includes(contractorNameLower) ||
                           contractorNameLower.includes(empContractorLower);
                }).length;
                
                return {
                    id: row.ROWID,
                    contractorName: contractorName,
                    rank: row.Rank || 0,
                    employees: activeEmployeeCount, // Use recalculated active employee count
                    cirCount: row.CIRCount || 0,
                    ehsViolations: row.EHSViolations || 0,
                    overallScore: row.OverallScore || 0,
                    status: row.Status || 'Unknown',
                    lastUpdated: row.LastUpdated || row.CREATEDTIME || new Date().toISOString()
                };
            });
            
            // Sort by overall score (highest first) and update ranks
            let sortedData = performanceData
                .sort((a, b) => b.overallScore - a.overallScore)
                .map((item, index) => ({
                    ...item,
                    rank: index + 1
                }));
            
            // Filter by contractor for App Users
            if (userRole === 'App User' && userEmail) {
                let contractorName = null;
                // Use the same contractor mapping logic
                if (userEmail === "afrindinusha29@gmail.com") {
                    contractorName = "Sriram Enterprises";
                } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com") {
                    contractorName = "R.P.D Facility Management Services";
                } else if (userEmail === "afrinatlin@gmail.com") {
                    contractorName = "Samuel Enterprise";
                } else if (userEmail === "dinushaafrin@gmail.com") {
                    contractorName = "Sri Balaji Enterprises";
                } else if (userEmail === "afrindinu14@gmail.com") {
                    contractorName = "Yashaswi Academy for Skills";
                }
                
                if (contractorName) {
                    const normalizedContractor = contractorName.replace(/\s+/g, ' ').trim().toLowerCase();
                    const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
                    
                    sortedData = sortedData.filter(item => {
                        const itemContractor = (item.contractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
                        if (itemContractor === normalizedContractor) return true;
                        if (contractorWords.length > 0) {
                            const allKeyWordsMatch = contractorWords.every(word => itemContractor.includes(word));
                            if (allKeyWordsMatch) {
                                const firstWord = contractorWords[0];
                                const itemFirstWord = itemContractor.split(' ')[0];
                                if (itemFirstWord && (itemFirstWord.startsWith(firstWord) || firstWord.startsWith(itemFirstWord))) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }).map((item, idx) => ({ ...item, rank: idx + 1 }));
                    
                    console.log(`Filtered contractor performance for ${contractorName}:`, sortedData.length, 'records');
                }
            }
            
            return res.status(200).send({
                status: 'success',
                data: {
                    performanceData: sortedData,
                    source: 'ContractorPerformance table',
                    total: sortedData.length
                }
            });
            
        } catch (tableError) {
            console.log('ContractorPerformance table not found, calculating from existing data...');
            
            // Fallback: Calculate performance from existing tables
            const contractorsTable = catalyst.datastore().table('Contractors');
            const ehsViolationsTable = catalyst.datastore().table('EHSViolation');
            const criticalIncidentsTable = catalyst.datastore().table('CriticalIncident');
            const employeeTable = catalyst.datastore().table('Employee');
            
            // Get all contractors
            const contractors = await contractorsTable.getAllRows();
            
            // Get all EHS violations
            const ehsViolations = await ehsViolationsTable.getAllRows();
            
            // Get all critical incidents
            const criticalIncidents = await criticalIncidentsTable.getAllRows();
            console.log('Total critical incidents found:', criticalIncidents.length);
            console.log('Sample critical incident:', criticalIncidents[0]);
            
            // Get all employees for real-time count
            const allEmployees = await employeeTable.getAllRows();
            console.log('Total employees found:', allEmployees.length);
            console.log('Sample employee:', allEmployees[0]);
            
            // Calculate performance for each contractor
            const performanceData = contractors.map((contractor, index) => {
                const contractorName = contractor.NameoftheSiteManager || 
                                     contractor.NameofSiteIncharge || 
                                     contractor.OrganizationName || 
                                     contractor.ContractorName || 
                                     `Contractor ${index + 1}`;
                
                console.log(`Processing contractor: ${contractorName}`);
                
                // Count EHS violations for this contractor
                const contractorEHSViolations = ehsViolations.filter(violation => 
                    violation.Contractor === contractorName || 
                    violation.Contractor === contractor.OrganizationName ||
                    violation.Contractor === contractor.ContractorName
                ).length;
                
                console.log(`Contractor: ${contractorName} - EHS Violations: ${contractorEHSViolations}`);
                
                // Count Critical Incidents for this contractor
                // First, get all active employees for this contractor
                const contractorEmployees = allEmployees.filter(emp => {
                    // Filter by active status first
                    const empStatus = emp.employeeStatus || emp.EmployeeStatus || '';
                    const isActive = empStatus === 'Active';
                    if (!isActive) return false;
                    
                    const empContractor = emp.ContractorName || emp.contractor || '';
                    const contractorNameLower = contractorName.toLowerCase().trim();
                    const empContractorLower = empContractor.toString().toLowerCase().trim();
                    
                    return empContractorLower === contractorNameLower ||
                           empContractorLower.includes(contractorNameLower) ||
                           contractorNameLower.includes(empContractorLower);
                });
                
                // Get employee codes/IDs for this contractor
                const contractorEmployeeCodes = contractorEmployees.map(emp => 
                    emp.EmployeeCode || emp.employeeCode || emp.ContractEmployeeID || emp.contractEmployeeID || emp.id || ''
                ).filter(code => code); // Remove empty codes
                
                console.log(`Contractor: ${contractorName} - Employee codes:`, contractorEmployeeCodes);
                
                // Count critical incidents involving employees of this contractor
                const contractorCIRCount = criticalIncidents.filter(incident => {
                    if (!incident.ContractEmplyee) return false;
                    
                    // Check if the incident involves any employee of this contractor
                    return contractorEmployeeCodes.some(employeeCode => 
                        incident.ContractEmplyee.toString().toLowerCase().includes(employeeCode.toString().toLowerCase()) ||
                        employeeCode.toString().toLowerCase().includes(incident.ContractEmplyee.toString().toLowerCase())
                    );
                }).length;
                
                console.log(`Contractor: ${contractorName} - CIR Count: ${contractorCIRCount}`);
                
                // Calculate overall score (base 100, deduct for violations)
                let overallScore = 100;
                
                // Deduct points for CIR violations
                if (contractorCIRCount >= 7) overallScore -= 80;
                else if (contractorCIRCount >= 5) overallScore -= 60;
                else if (contractorCIRCount >= 3) overallScore -= 40;
                else if (contractorCIRCount >= 1) overallScore -= 20;
                
                // Deduct points for EHS violations
                if (contractorEHSViolations >= 8) overallScore -= 80;
                else if (contractorEHSViolations >= 6) overallScore -= 60;
                else if (contractorEHSViolations >= 4) overallScore -= 40;
                else if (contractorEHSViolations >= 2) overallScore -= 20;
                
                overallScore = Math.max(0, overallScore);
                
                // Determine status based on score
                let status = 'Unknown';
                if (overallScore >= 80) status = 'Excellent';
                else if (overallScore >= 60) status = 'Good';
                else if (overallScore >= 40) status = 'Average';
                else status = 'Poor';
                
                // Calculate real-time employee count for this contractor (only active employees)
                const realTimeEmployeeCount = allEmployees.filter(emp => {
                    // Filter by active status first
                    const empStatus = emp.employeeStatus || emp.EmployeeStatus || '';
                    const isActive = empStatus === 'Active';
                    if (!isActive) return false;
                    
                    const empContractor = emp.ContractorName || emp.contractor || '';
                    const contractorNameLower = contractorName.toLowerCase().trim();
                    const empContractorLower = empContractor.toString().toLowerCase().trim();
                    
                    return empContractorLower === contractorNameLower ||
                           empContractorLower.includes(contractorNameLower) ||
                           contractorNameLower.includes(empContractorLower);
                }).length;
                
                console.log(`Contractor: ${contractorName} - Real-time employee count: ${realTimeEmployeeCount}`);
                
                return {
                    id: contractor.ROWID || index + 1,
                    contractorName: contractorName,
                    rank: 0, // Will be set after sorting
                    employees: realTimeEmployeeCount || 
                              contractor.NumberOfEmployeesasperRC || 
                              contractor.NumberOfEmployees || 
                              0, // Default to 0 if no employees found
                    cirCount: contractorCIRCount,
                    ehsViolations: contractorEHSViolations,
                    overallScore: overallScore,
                    status: status,
                    lastUpdated: contractor.MODIFIEDTIME || contractor.CREATEDTIME || new Date().toISOString()
                };
            });
            
            // Sort by overall score (highest first) and update ranks
            let sortedData = performanceData
                .sort((a, b) => b.overallScore - a.overallScore)
                .map((item, index) => ({
                    ...item,
                    rank: index + 1
                }));
            
            // Filter by contractor for App Users
            if (userRole === 'App User' && userEmail) {
                let contractorName = null;
                // Use the same contractor mapping logic
                if (userEmail === "afrindinusha29@gmail.com") {
                    contractorName = "Sriram Enterprises";
                } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com") {
                    contractorName = "R.P.D Facility Management Services";
                } else if (userEmail === "afrinatlin@gmail.com") {
                    contractorName = "Samuel Enterprise";
                } else if (userEmail === "dinushaafrin@gmail.com") {
                    contractorName = "Sri Balaji Enterprises";
                } else if (userEmail === "afrindinu14@gmail.com") {
                    contractorName = "Yashaswi Academy for Skills";
                }
                
                if (contractorName) {
                    const normalizedContractor = contractorName.replace(/\s+/g, ' ').trim().toLowerCase();
                    const contractorWords = normalizedContractor.split(' ').filter(w => w.length > 2);
                    
                    sortedData = sortedData.filter(item => {
                        const itemContractor = (item.contractorName || '').replace(/\s+/g, ' ').trim().toLowerCase();
                        if (itemContractor === normalizedContractor) return true;
                        if (contractorWords.length > 0) {
                            const allKeyWordsMatch = contractorWords.every(word => itemContractor.includes(word));
                            if (allKeyWordsMatch) {
                                const firstWord = contractorWords[0];
                                const itemFirstWord = itemContractor.split(' ')[0];
                                if (itemFirstWord && (itemFirstWord.startsWith(firstWord) || firstWord.startsWith(itemFirstWord))) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }).map((item, idx) => ({ ...item, rank: idx + 1 }));
                    
                    console.log(`Filtered contractor performance for ${contractorName}:`, sortedData.length, 'records');
                }
            }
            
            // Log summary for debugging
            const totalEmployees = sortedData.reduce((sum, item) => sum + item.employees, 0);
            const totalCIRCount = sortedData.reduce((sum, item) => sum + item.cirCount, 0);
            const totalEHSViolations = sortedData.reduce((sum, item) => sum + item.ehsViolations, 0);
            console.log(`Performance calculation complete. Total contractors: ${sortedData.length}, Total employees: ${totalEmployees}, Total CIR: ${totalCIRCount}, Total EHS: ${totalEHSViolations}`);
            
            return res.status(200).send({
                status: 'success',
                data: {
                    performanceData: sortedData,
                    source: 'Calculated from existing tables',
                    total: sortedData.length,
                    totalEmployees: totalEmployees,
                    totalCIRCount: totalCIRCount,
                    totalEHSViolations: totalEHSViolations
                }
            });
        }
        
    } catch (err) {
        console.error('GET /contractor-performance error:', err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to fetch contractor performance data.",
            error: err.message
        });
    }
});

// POST API: Create or update contractor performance record
app.post('/contractor-performance', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const body = req.body;
        
        // Validate required fields
        if (!body.ContractorName) {
            return res.status(400).send({
                status: 'failure',
                message: 'Contractor Name is required.'
            });
        }
        
        // Try to get or create the ContractorPerformance table
        let performanceTable;
        try {
            performanceTable = catalyst.datastore().table('ContractorPerformance');
        } catch (tableError) {
            console.log('ContractorPerformance table not found, creating...');
            // You would need to create the table here if it doesn't exist
            // For now, we'll return an error suggesting to create the table
            return res.status(500).send({
                status: 'failure',
                message: 'ContractorPerformance table does not exist. Please create the table first with the required columns: ContractorName, Rank, EmployeeCount, CIRCount, EHSViolations, OverallScore, Status, LastUpdated'
            });
        }
        
        const payload = {
            ContractorName: body.ContractorName,
            Rank: body.Rank || 0,
            EmployeeCount: body.EmployeeCount || 0,
            CIRCount: body.CIRCount || 0,
            EHSViolations: body.EHSViolations || 0,
            OverallScore: body.OverallScore || 0,
            Status: body.Status || 'Unknown',
            LastUpdated: new Date().toISOString()
        };
        
        const { ROWID: id } = await performanceTable.insertRow(payload);
        
        res.status(200).send({
            status: 'success',
            data: { 
                performanceRecord: { id, ...payload },
                message: 'Contractor performance record created successfully.'
            }
        });
        
    } catch (err) {
        console.error('POST /contractor-performance error:', err);
        res.status(500).send({
            status: 'failure',
            message: 'Failed to create contractor performance record.',
            error: err.message
        });
    }
});

// File upload endpoints
// Upload file for new contractor
app.post('/contractors/new-upload/:documentType', async (req, res) => {
    try {
        console.log('=== CLEAN NEW CONTRACTOR UPLOAD - NO DATABASE OPERATIONS ===');
        console.log('New contractor file upload request for documentType:', req.params.documentType);
        console.log('Request files:', req.files);
        
        if (!req.files || !req.files.file) {
            console.error('No file uploaded for documentType:', req.params.documentType);
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
        const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.name).toLowerCase();
        if (!allowedTypes.includes(ext)) {
            console.error('Invalid file type:', ext, 'for file:', file.name);
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.'
            });
        }
        
        const { documentType } = req.params;
        const { catalyst } = res.locals;
        const filestore = catalyst.filestore();
        
        // Map document types to folder IDs based on the provided folder names
        const folderMapping = {
            'ContractorAadhar': '12381000000081713',
            'ContractorPAN': '12381000000081694',
            'ESIRegistrationCertificate': '12381000000081675',
            'PFRegistrationCertificate': '12381000000081656',
            'GSTRegistrationCertificate': '12381000000081637',
            'OrganizationPAN': '12381000000081618',
            'RegistrationCertificate': '12381000000030016'
        };
        
        const folderId = folderMapping[documentType];
        console.log('Folder ID for documentType:', documentType, 'is:', folderId);
        
        if (!folderId) {
            console.error('Invalid document type:', documentType);
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid document type'
            });
        }
        
        // Get the folder for the specific document type
        const folder = filestore.folder(folderId);
        
        // Generate unique filename
        const timestamp = Date.now();
        const filename = `${documentType}_${timestamp}${ext}`;
        console.log('Generated filename:', filename);
        
        // Create temporary file path
        const tempPath = `/tmp/${filename}`;
        await file.mv(tempPath);
        console.log('File moved to temp path:', tempPath);
        
        // Upload to filestore folder using the correct API
        console.log('Starting file upload to Catalyst...');
        const uploadResponse = await folder.uploadFile({
            code: fs.createReadStream(tempPath),
            name: filename,
        });
        console.log('Upload response received:', uploadResponse);

        // Clean up temporary file
        fs.unlinkSync(tempPath);
        console.log('Temporary file cleaned up');

        // Handle different possible response structures
        let fileId, fileName;
        if (Array.isArray(uploadResponse) && uploadResponse[0]?.id) {
            fileId = uploadResponse[0].id;
            fileName = file.name;
        } else if (uploadResponse && uploadResponse.id) {
            fileId = uploadResponse.id;
            fileName = file.name;
        } else if (uploadResponse && uploadResponse.file_details && uploadResponse.file_details[0]?.id) {
            fileId = uploadResponse.file_details[0].id;
            fileName = file.name;
        } else {
            console.error('Unexpected upload response:', uploadResponse);
            throw new Error('File upload failed or invalid response from Catalyst.');
        }

        console.log('File upload successful. FileId:', fileId, 'FileName:', fileName);
        console.log('=== UPLOAD COMPLETED - NO DATABASE OPERATIONS - NO contractorId REFERENCES ===');

        // Send success response immediately - no database operations for new contractors
        const responseData = {
            status: 'success',
            fileId: fileId.toString(),
            fileName: fileName
        };
        
        console.log('Sending response:', responseData);
        res.status(200).send(responseData);
        console.log('=== FUNCTION COMPLETED SUCCESSFULLY ===');
        
    } catch (err) {
        console.error('File upload error:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        
        let errorMessage = 'Failed to upload file';
        if (err.message.includes('File upload failed')) {
            errorMessage = 'File upload to Catalyst failed. Please try again.';
        } else if (err.message.includes('Invalid file type')) {
            errorMessage = 'Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.';
        } else if (err.message.includes('File too large')) {
            errorMessage = 'File size exceeds the 5MB limit.';
        }
        
        res.status(500).send({
            status: 'failure',
            message: errorMessage,
            error: err.message
        });
    }
});

// Upload file for existing contractor
app.post('/contractors/:ROWID/upload/:documentType', async (req, res) => {
    try {
        console.log('Existing contractor file upload request for ROWID:', req.params.ROWID, 'documentType:', req.params.documentType);
        console.log('Request files:', req.files);
        
        if (!req.files || !req.files.file) {
            console.error('No file uploaded for contractor ROWID:', req.params.ROWID, 'documentType:', req.params.documentType);
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
        const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.name).toLowerCase();
        if (!allowedTypes.includes(ext)) {
            console.error('Invalid file type:', ext, 'for file:', file.name);
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.'
            });
        }
        
        const { ROWID, documentType } = req.params;
        const { catalyst } = res.locals;
        const filestore = catalyst.filestore();
        
        // Map document types to folder IDs based on the provided folder names
        const folderMapping = {
            'ContractorAadhar': '12381000000081713',
            'ContractorPAN': '12381000000081694',
            'ESIRegistrationCertificate': '12381000000081675',
            'PFRegistrationCertificate': '12381000000081656',
            'GSTRegistrationCertificate': '12381000000081637',
            'OrganizationPAN': '12381000000081618',
            'RegistrationCertificate': '12381000000030016'
        };
        
        // Map document types to database field names
        const fieldMapping = {
            'ContractorAadhar': 'ContractorAadharFileId',
            'ContractorPAN': 'ContractorPANFileId',
            'ESIRegistrationCertificate': 'ESIRegistrationCertificateFileId',
            'PFRegistrationCertificate': 'PFRegistrationCertificateFileId',
            'GSTRegistrationCertificate': 'GSTRegistrationCertificateFileId',
            'OrganizationPAN': 'OrganizationPANFileId',
            'RegistrationCertificate': 'RegistrationCertificateFileId'
        };
        
        const folderId = folderMapping[documentType];
        const fieldName = fieldMapping[documentType];
        console.log('Folder ID for documentType:', documentType, 'is:', folderId);
        console.log('Field name for documentType:', documentType, 'is:', fieldName);
        
        if (!folderId) {
            console.error('Invalid document type:', documentType);
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid document type'
            });
        }
        
        // Get the folder for the specific document type
        const folder = filestore.folder(folderId);
        
        // Generate unique filename
        const timestamp = Date.now();
        const filename = `${documentType}_${timestamp}${ext}`;
        console.log('Generated filename:', filename);
        
        // Create temporary file path
        const tempPath = `/tmp/${filename}`;
        await file.mv(tempPath);
        console.log('File moved to temp path:', tempPath);
        
        // Upload to filestore folder using the correct API
        console.log('Starting file upload to Catalyst...');
        const uploadResponse = await folder.uploadFile({
            code: fs.createReadStream(tempPath),
            name: filename,
        });
        console.log('Upload response received:', uploadResponse);

        // Clean up temporary file
        fs.unlinkSync(tempPath);
        console.log('Temporary file cleaned up');

        // Handle different possible response structures
        let fileId, fileName;
        if (Array.isArray(uploadResponse) && uploadResponse[0]?.id) {
            fileId = uploadResponse[0].id;
            fileName = file.name;
        } else if (uploadResponse && uploadResponse.id) {
            fileId = uploadResponse.id;
            fileName = file.name;
        } else if (uploadResponse && uploadResponse.file_details && uploadResponse.file_details[0]?.id) {
            fileId = uploadResponse.file_details[0].id;
            fileName = file.name;
        } else {
            console.error('Unexpected upload response:', uploadResponse);
            throw new Error('File upload failed or invalid response from Catalyst.');
        }

        console.log('File upload successful. FileId:', fileId, 'FileName:', fileName);

        // Update contractor record with file information
        try {
            const table = catalyst.datastore().table('Contractors');
            const fileNameField = fieldName.replace('FileId', 'FileName');
            await table.updateRow({
                ROWID: ROWID,
                [fieldName]: fileId,
                [fileNameField]: fileName
            });
            console.log('Contractor record updated with file information');
        } catch (updateErr) {
            console.error('Failed to update contractor record:', updateErr);
            // Don't fail the upload if the update fails
        }

        res.status(200).send({
            status: 'success',
            fileId: fileId.toString(),
            fileName: fileName
        });
    } catch (err) {
        console.error('File upload error:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        
        let errorMessage = 'Failed to upload file';
        if (err.message.includes('File upload failed')) {
            errorMessage = 'File upload to Catalyst failed. Please try again.';
        } else if (err.message.includes('Invalid file type')) {
            errorMessage = 'Invalid file type. Only PDF, JPG, JPEG, and PNG files are allowed.';
        } else if (err.message.includes('File too large')) {
            errorMessage = 'File size exceeds the 5MB limit.';
        }
        
        res.status(500).send({
            status: 'failure',
            message: errorMessage,
            error: err.message
        });
    }
});

// Get files list for a specific document type
app.get('/files/:documentType', async (req, res) => {
    try {
        const { documentType } = req.params;
        const { catalyst } = res.locals;
        const filestore = catalyst.filestore();
        
        // Map document types to folder IDs based on the provided folder names
        const folderMapping = {
            'ContractorAadhar': '12381000000081713',
            'ContractorPAN': '12381000000081694',
            'ESIRegistrationCertificate': '12381000000081675',
            'PFRegistrationCertificate': '12381000000081656',
            'GSTRegistrationCertificate': '12381000000081637',
            'OrganizationPAN': '12381000000081618',
            'RegistrationCertificate': '12381000000030016'
        };
        
        const folderId = folderMapping[documentType];
        if (!folderId) {
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid document type'
            });
        }
        
        // Get the folder for the specific document type
        const folder = filestore.folder(folderId);
        
        // Get all files in the folder
        const files = await folder.getAllFiles();
        
        res.status(200).send({
            status: 'success',
            data: {
                files: files.map(file => ({
                    id: file.id,
                    name: file.name,
                    size: file.size,
                    createdTime: file.created_time,
                    modifiedTime: file.modified_time
                }))
            }
        });
    } catch (err) {
        console.error('Get files error:', err);
        res.status(500).send({
            status: 'failure',
            message: 'Failed to get files list'
        });
    }
});

// Download file
app.get('/file/:documentType/:fileId', async (req, res) => {
    try {
        const { fileId, documentType } = req.params;
        const { catalyst } = res.locals;
        const filestore = catalyst.filestore();
        
        // Map document types to folder IDs based on the provided folder names
        const folderMapping = {
            'ContractorAadhar': '12381000000081713',
            'ContractorPAN': '12381000000081694',
            'ESIRegistrationCertificate': '12381000000081675',
            'PFRegistrationCertificate': '12381000000081656',
            'GSTRegistrationCertificate': '12381000000081637',
            'OrganizationPAN': '12381000000081618',
            'RegistrationCertificate': '12381000000030016'
        };
        
        const folderId = folderMapping[documentType];
        if (!folderId) {
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid document type'
            });
        }
        
        // Get the folder for the specific document type
        const folder = filestore.folder(folderId);
        
        const fileBuffer = await folder.downloadFile(fileId);
        if (!fileBuffer) {
            return res.status(404).send({
                status: 'failure',
                message: 'File not found'
            });
        }

        // Get file info for content type
        const fileInfo = await folder.getFileInfo(fileId);
        const contentType = fileInfo?.content_type || 'application/octet-stream';
        const fileName = fileInfo?.name || 'download';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        res.send(fileBuffer);
    } catch (err) {
        console.error('File download error:', err);
        res.status(500).send({
            status: 'failure',
            message: 'Failed to download file'
        });
    }
});

// Delete file
app.delete('/file/:documentType/:fileId', async (req, res) => {
    try {
        const { fileId, documentType } = req.params;
        const { catalyst } = res.locals;
        const filestore = catalyst.filestore();
        
        // Map document types to folder IDs based on the provided folder names
        const folderMapping = {
            'ContractorAadhar': '12381000000081713',
            'ContractorPAN': '12381000000081694',
            'ESIRegistrationCertificate': '12381000000081675',
            'PFRegistrationCertificate': '12381000000081656',
            'GSTRegistrationCertificate': '12381000000081637',
            'OrganizationPAN': '12381000000081618',
            'RegistrationCertificate': '12381000000030016'
        };
        
        const folderId = folderMapping[documentType];
        if (!folderId) {
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid document type'
            });
        }
        
        // Get the folder for the specific document type
        const folder = filestore.folder(folderId);
        
        // Delete the file
        await folder.deleteFile(fileId);
        
        res.status(200).send({
            status: 'success',
            message: 'File deleted successfully'
        });
    } catch (err) {
        console.error('Delete file error:', err);
        res.status(500).send({
            status: 'failure',
            message: 'Failed to delete file'
        });
    }
});

module.exports = app;