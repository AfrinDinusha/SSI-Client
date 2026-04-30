'use strict';

const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');

const app = express();

app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Test endpoint to check if function is working
app.get('/test', (req, res) => {
    res.status(200).send({
        status: 'success',
        message: 'CriticalIncident function is working!',
        timestamp: new Date().toISOString()
    });
});

// Test endpoint to check table schema
app.get('/test-schema', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        
        try {
            const table = datastore.table('CriticalIncident');
            const zcql = catalyst.zcql();
            
            // Try to get table structure
            const result = await zcql.executeZCQLQuery('SELECT * FROM CriticalIncident LIMIT 1');
            
            res.status(200).send({
                status: 'success',
                message: 'Table exists and is accessible',
                columns: result.length > 0 ? Object.keys(result[0].CriticalIncident) : [],
                timestamp: new Date().toISOString()
            });
        } catch (tableError) {
            res.status(500).send({
                status: 'failure',
                message: 'Table access error: ' + tableError.message,
                timestamp: new Date().toISOString()
            });
        }
    } catch (err) {
        res.status(500).send({
            status: 'failure',
            message: 'Schema test error: ' + err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET: List Critical Incidents (paginated)
app.get('/incidents', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
        const page = parseInt(req.query.page) || 1;
        const perPage = Math.min(parseInt(req.query.perPage) || 50, 300);
        const zcql = catalyst.zcql();
        
        console.log('Fetching incidents with page:', page, 'perPage:', perPage, 'userEmail:', userEmail, 'userRole:', userRole);
        
        // Check if table exists first
        try {
            const tableCheck = await zcql.executeZCQLQuery(`SELECT ROWID FROM CriticalIncident LIMIT 1`);
            console.log('Table check successful');
        } catch (tableErr) {
            console.error('Table check failed:', tableErr.message);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'CriticalIncident table does not exist. Please create the table first.' 
            });
        }
        
        // Determine contractor for App Users
        let allowedContractor = null;
        if (userRole === 'App User' && userEmail) {
            // Try to get contractor from localStorage mapping (same logic as other endpoints)
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                allowedContractor = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                allowedContractor = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                allowedContractor = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                allowedContractor = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                allowedContractor = "Yashaswi Academy for Skills";
            }
            console.log('App User contractor filter:', allowedContractor);
        }
        
        // Get all incidents first (we need to filter by contractor)
        let allIncidentsResult;
        try {
            allIncidentsResult = await zcql.executeZCQLQuery(
                `SELECT ROWID, Date1, ContractEmplyee, Details, Status, CREATEDTIME, MODIFIEDTIME 
                 FROM CriticalIncident 
                 ORDER BY ROWID DESC`
            );
        } catch (queryErr) {
            console.error('Error fetching incidents:', queryErr);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'Failed to fetch incidents from database.' 
            });
        }
        
        // If App User, filter by contractor
        let filteredIncidents = allIncidentsResult.map(row => ({
            id: row.CriticalIncident.ROWID,
            Date1: row.CriticalIncident.Date1,
            ContractEmplyee: row.CriticalIncident.ContractEmplyee,
            Details: row.CriticalIncident.Details,
            Status: row.CriticalIncident.Status,
            createdTime: row.CriticalIncident.CREATEDTIME,
            modifiedTime: row.CriticalIncident.MODIFIEDTIME
        }));
        
        if (userRole === 'App User' && allowedContractor) {
            // Get all employees to match contractor
            const employeeTable = catalyst.datastore().table('Employee');
            let allEmployees = [];
            try {
                allEmployees = await employeeTable.getAllRows();
                console.log('Total employees found for contractor filtering:', allEmployees.length);
            } catch (empErr) {
                console.error('Error fetching employees:', empErr);
                // Continue without filtering if employee fetch fails
            }
            
            // Filter incidents by contractor
            const normalizedAllowedContractor = allowedContractor.replace(/\s+/g, ' ').trim().toLowerCase();
            filteredIncidents = filteredIncidents.filter(incident => {
                if (!incident.ContractEmplyee) return false;
                
                // Try to find the employee by code or name
                const contractEmployee = String(incident.ContractEmplyee).trim();
                
                // Find employee by code or name
                const matchingEmployee = allEmployees.find(emp => {
                    const empCode = String(emp.EmployeeCode || emp.employeeCode || emp.ContractEmployeeID || emp.contractEmployeeID || emp.id || '').trim();
                    const empName = String(emp.EmployeeName || emp.employeeName || '').trim();
                    
                    // Check if ContractEmplyee matches code or name
                    const matchesCode = empCode && contractEmployee.toLowerCase() === empCode.toLowerCase();
                    const matchesName = empName && contractEmployee.toLowerCase() === empName.toLowerCase();
                    const matchesCodeInName = empName && empName.toLowerCase().includes(contractEmployee.toLowerCase());
                    const matchesNameInCode = contractEmployee.toLowerCase().includes(empName.toLowerCase());
                    
                    return matchesCode || matchesName || matchesCodeInName || matchesNameInCode;
                });
                
                if (!matchingEmployee) {
                    console.log(`No matching employee found for ContractEmplyee: ${contractEmployee}`);
                    return false; // Exclude if employee not found
                }
                
                // Get contractor from employee
                const empContractor = matchingEmployee.ContractorName || matchingEmployee.contractor || matchingEmployee.Contractor || '';
                const empContractorLower = String(empContractor).toLowerCase().trim();
                
                // Check if contractor matches
                const contractorMatches = empContractorLower === normalizedAllowedContractor ||
                                        empContractorLower.includes(normalizedAllowedContractor) ||
                                        normalizedAllowedContractor.includes(empContractorLower);
                
                if (!contractorMatches) {
                    console.log(`Contractor mismatch: Employee contractor: ${empContractor}, Allowed: ${allowedContractor}`);
                }
                
                return contractorMatches;
            });
            
            console.log(`Filtered incidents for contractor ${allowedContractor}: ${filteredIncidents.length} out of ${allIncidentsResult.length}`);
        }
        
        // Apply pagination after filtering
        const total = filteredIncidents.length;
        const startIndex = (page - 1) * perPage;
        const endIndex = startIndex + perPage;
        const paginatedIncidents = filteredIncidents.slice(startIndex, endIndex);
        
        res.status(200).send({
            status: 'success',
            data: { 
                incidents: paginatedIncidents, 
                total, 
                hasMore: endIndex < total,
                page,
                perPage
            }
        });
    } catch (err) {
        console.error('GET /incidents error:', err, err.stack);
        res.status(500).send({ 
            status: 'failure', 
            message: err.message || "Unable to fetch critical incidents." 
        });
    }
});

// Helper function to check if incident belongs to contractor
async function incidentBelongsToContractor(catalyst, incident, allowedContractor) {
    if (!allowedContractor || !incident.ContractEmplyee) {
        return true; // If no contractor filter or no employee, allow access
    }
    
    try {
        const employeeTable = catalyst.datastore().table('Employee');
        const allEmployees = await employeeTable.getAllRows();
        
        const contractEmployee = String(incident.ContractEmplyee).trim();
        const normalizedAllowedContractor = allowedContractor.replace(/\s+/g, ' ').trim().toLowerCase();
        
        // Find employee by code or name
        const matchingEmployee = allEmployees.find(emp => {
            const empCode = String(emp.EmployeeCode || emp.employeeCode || emp.ContractEmployeeID || emp.contractEmployeeID || emp.id || '').trim();
            const empName = String(emp.EmployeeName || emp.employeeName || '').trim();
            
            const matchesCode = empCode && contractEmployee.toLowerCase() === empCode.toLowerCase();
            const matchesName = empName && contractEmployee.toLowerCase() === empName.toLowerCase();
            const matchesCodeInName = empName && empName.toLowerCase().includes(contractEmployee.toLowerCase());
            const matchesNameInCode = contractEmployee.toLowerCase().includes(empName.toLowerCase());
            
            return matchesCode || matchesName || matchesCodeInName || matchesNameInCode;
        });
        
        if (!matchingEmployee) {
            return false; // Employee not found, deny access
        }
        
        // Get contractor from employee
        const empContractor = matchingEmployee.ContractorName || matchingEmployee.contractor || matchingEmployee.Contractor || '';
        const empContractorLower = String(empContractor).toLowerCase().trim();
        
        // Check if contractor matches
        return empContractorLower === normalizedAllowedContractor ||
               empContractorLower.includes(normalizedAllowedContractor) ||
               normalizedAllowedContractor.includes(empContractorLower);
    } catch (err) {
        console.error('Error checking contractor for incident:', err);
        return true; // On error, allow access (fail open)
    }
}

// GET: Single Critical Incident
app.get('/incidents/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
        const zcql = catalyst.zcql();
        
        // Determine contractor for App Users
        let allowedContractor = null;
        if (userRole === 'App User' && userEmail) {
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                allowedContractor = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                allowedContractor = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                allowedContractor = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                allowedContractor = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                allowedContractor = "Yashaswi Academy for Skills";
            }
        }
        
        const result = await zcql.executeZCQLQuery(
            `SELECT ROWID, Date1, ContractEmplyee, Details, Status, CREATEDTIME, MODIFIEDTIME 
             FROM CriticalIncident WHERE ROWID = ${id}`
        );
        
        if (result.length === 0) {
            return res.status(404).send({ 
                status: 'failure', 
                message: 'Critical incident not found.' 
            });
        }
        
        const incident = {
            id: result[0].CriticalIncident.ROWID,
            Date1: result[0].CriticalIncident.Date1,
            ContractEmplyee: result[0].CriticalIncident.ContractEmplyee,
            Details: result[0].CriticalIncident.Details,
            Status: result[0].CriticalIncident.Status,
            createdTime: result[0].CriticalIncident.CREATEDTIME,
            modifiedTime: result[0].CriticalIncident.MODIFIEDTIME
        };
        
        // Check if App User has access to this incident
        if (userRole === 'App User' && allowedContractor) {
            const hasAccess = await incidentBelongsToContractor(catalyst, incident, allowedContractor);
            if (!hasAccess) {
                return res.status(403).send({ 
                    status: 'failure', 
                    message: 'You do not have access to this critical incident.' 
                });
            }
        }
        
        res.status(200).send({ 
            status: 'success', 
            data: { incident } 
        });
    } catch (err) {
        console.error('GET /incidents/:id error:', err);
        res.status(500).send({ 
            status: 'failure', 
            message: 'Failed to fetch critical incident.' 
        });
    }
});

// POST: Add Critical Incident
app.post('/incidents', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        
        // Check if table exists
        const datastore = catalyst.datastore();
        let table;
        try {
            table = datastore.table('CriticalIncident');
        } catch (tableError) {
            console.error('Table access error:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'CriticalIncident table not found. Please create the table first.' 
            });
        }
        
        const { 
            Date1, 
            ContractEmplyee, 
            Details, 
            Status 
        } = req.body;
        
        // Validation
        if (!ContractEmplyee) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Contract Employee is required.' 
            });
        }
        
        if (!Details) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Details are required.' 
            });
        }
        
        if (!Status) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Status is required.' 
            });
        }
        
        // Prepare row data with proper column names
        const rowData = {
            Date1: Date1 || null,
            ContractEmplyee: ContractEmplyee || null,
            Details: Details || null,
            Status: Status || null
        };
        
        console.log('Inserting row data:', rowData);
        const insertedRow = await table.insertRow(rowData);
        console.log('Row inserted successfully:', insertedRow.ROWID);
        
        res.status(200).send({
            status: 'success',
            data: { 
                incident: { 
                    id: insertedRow.ROWID, 
                    ...rowData 
                } 
            }
        });
    } catch (err) {
        console.error('POST /incidents error:', err, err.stack);
        
        // Handle column name errors
        if (err.message && err.message.includes('Invalid input value for column name')) {
            console.error('Column name error details:', err);
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Database column name error. Please check the table schema.' 
            });
        }
        
        res.status(500).send({ 
            status: 'failure', 
            message: err.message || 'Failed to add critical incident.' 
        });
    }
});

// PUT: Update Critical Incident
app.put('/incidents/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
        const datastore = catalyst.datastore();
        const table = datastore.table('CriticalIncident');
        
        const { 
            Date1, 
            ContractEmplyee, 
            Details, 
            Status 
        } = req.body;
        
        // Validation
        if (!ContractEmplyee) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Contract Employee is required.' 
            });
        }
        
        if (!Details) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Details are required.' 
            });
        }
        
        if (!Status) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Status is required.' 
            });
        }
        
        // Check if incident exists and get full incident data
        const zcql = catalyst.zcql();
        const existingResult = await zcql.executeZCQLQuery(
            `SELECT ROWID, Date1, ContractEmplyee, Details, Status, CREATEDTIME, MODIFIEDTIME 
             FROM CriticalIncident WHERE ROWID = ${id}`
        );
        
        if (existingResult.length === 0) {
            return res.status(404).send({ 
                status: 'failure', 
                message: 'Critical incident not found.' 
            });
        }
        
        // Check contractor access for App Users
        if (userRole === 'App User' && userEmail) {
            let allowedContractor = null;
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                allowedContractor = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                allowedContractor = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                allowedContractor = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                allowedContractor = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                allowedContractor = "Yashaswi Academy for Skills";
            }
            
            if (allowedContractor) {
                const existingIncident = {
                    id: existingResult[0].CriticalIncident.ROWID,
                    ContractEmplyee: existingResult[0].CriticalIncident.ContractEmplyee
                };
                const hasAccess = await incidentBelongsToContractor(catalyst, existingIncident, allowedContractor);
                if (!hasAccess) {
                    return res.status(403).send({ 
                        status: 'failure', 
                        message: 'You do not have access to update this critical incident.' 
                    });
                }
            }
        }
        
        // Prepare row data with proper column names
        const rowData = {
            ROWID: id,
            Date1: Date1 || null,
            ContractEmplyee: ContractEmplyee || null,
            Details: Details || null,
            Status: Status || null
        };
        
        const updatedRow = await table.updateRow(rowData);
        
        res.status(200).send({
            status: 'success',
            data: { 
                incident: { 
                    id: updatedRow.ROWID, 
                    ...rowData 
                } 
            }
        });
    } catch (err) {
        console.error('PUT /incidents/:id error:', err);
        
        res.status(500).send({ 
            status: 'failure', 
            message: err.message || 'Failed to update critical incident.' 
        });
    }
});

// DELETE: Remove Critical Incident
app.delete('/incidents/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
        const datastore = catalyst.datastore();
        const table = datastore.table('CriticalIncident');
        
        // Check if incident exists and get full incident data
        const zcql = catalyst.zcql();
        const result = await zcql.executeZCQLQuery(
            `SELECT ROWID, Date1, ContractEmplyee, Details, Status, CREATEDTIME, MODIFIEDTIME 
             FROM CriticalIncident WHERE ROWID = ${id}`
        );
        
        if (result.length === 0) {
            return res.status(404).send({ 
                status: 'failure', 
                message: 'Critical incident not found.' 
            });
        }
        
        // Check contractor access for App Users
        if (userRole === 'App User' && userEmail) {
            let allowedContractor = null;
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                allowedContractor = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                allowedContractor = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                allowedContractor = "Samuel Enterprise";
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                allowedContractor = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com" || userEmail === "vaishnavi.a@buildhr.co.in") {
                allowedContractor = "Yashaswi Academy for Skills";
            }
            
            if (allowedContractor) {
                const incident = {
                    id: result[0].CriticalIncident.ROWID,
                    ContractEmplyee: result[0].CriticalIncident.ContractEmplyee
                };
                const hasAccess = await incidentBelongsToContractor(catalyst, incident, allowedContractor);
                if (!hasAccess) {
                    return res.status(403).send({ 
                        status: 'failure', 
                        message: 'You do not have access to delete this critical incident.' 
                    });
                }
            }
        }
        
        await table.deleteRow(id);
        
        res.status(200).send({ 
            status: 'success', 
            data: { incident: { id } } 
        });
    } catch (err) {
        console.error('DELETE /incidents/:id error:', err);
        res.status(500).send({ 
            status: 'failure', 
            message: "Unable to delete critical incident." 
        });
    }
});

// POST: Bulk Import Incidents
app.post('/incidents/bulk-import', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { incidents } = req.body;
        
        if (!Array.isArray(incidents)) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Incidents data must be an array.' 
            });
        }
        
        const datastore = catalyst.datastore();
        const table = datastore.table('CriticalIncident');
        
        const results = [];
        const errors = [];
        
        for (let i = 0; i < incidents.length; i++) {
            const incident = incidents[i];
            
            // Validation
            if (!incident.ContractEmplyee) {
                errors.push(`Row ${i + 1}: Contract Employee is required`);
                continue;
            }
            
            if (!incident.Details) {
                errors.push(`Row ${i + 1}: Details are required`);
                continue;
            }
            
            if (!incident.Status) {
                errors.push(`Row ${i + 1}: Status is required`);
                continue;
            }
            
            try {
                const rowData = {
                    Date1: incident.Date1 || null,
                    ContractEmplyee: incident.ContractEmplyee,
                    Details: incident.Details,
                    Status: incident.Status
                };
                
                const insertedRow = await table.insertRow(rowData);
                results.push({
                    id: insertedRow.ROWID,
                    ...rowData
                });
            } catch (err) {
                errors.push(`Row ${i + 1}: ${err.message}`);
            }
        }
        
        res.status(200).send({
            status: 'success',
            data: { 
                imported: results.length,
                errors: errors.length,
                errorDetails: errors,
                incidents: results
            }
        });
    } catch (err) {
        console.error('POST /incidents/bulk-import error:', err);
        res.status(500).send({ 
            status: 'failure', 
            message: err.message || 'Failed to import incidents.' 
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send({ 
        status: 'failure', 
        message: 'Internal server error.' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send({ 
        status: 'failure', 
        message: 'Endpoint not found.' 
    });
});

module.exports = app;