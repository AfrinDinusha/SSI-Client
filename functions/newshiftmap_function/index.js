'use strict';

const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
// Increase body parser limit to handle large Excel imports (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Get all shift schedule records
app.get('/newshiftmaps', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userRole = (req.query.userRole || '').trim();
        const userEmail = (req.query.userEmail || '').trim();
        const startDate = req.query.startDate || '';
        const endDate = req.query.endDate || '';
        const isAppAdministrator = userRole.toLowerCase() === 'app administrator';
        const activeCondition = '(employeeStatus = \'Active\' OR EmployeeStatus = \'Active\')';
        
        let employeeIds = [];
        
        // If user is App User (contractor), filter by contractor email and active only. App Administrator never filtered here.
        if (!isAppAdministrator && userRole === 'App User' && userEmail) {
            let contractorName = null;
           
            // Check hardcoded mappings
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                try {
                    const samuelQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%Samuel%' LIMIT 10`
                    );
                    if (samuelQuery && samuelQuery.length > 0) {
                        contractorName = samuelQuery[0].Employee?.ContractorName;
                    } else {
                        contractorName = "Samuel Enterprises";
                    }
                } catch (samuelError) {
                    contractorName = "Samuel Enterprises";
                }
            } else if (userEmail === "dinushaafrin@gmail.com" || userEmail === "vijaybalaji701@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
            } else if (userEmail === "afrindinu14@gmail.com") {
                try {
                    const napsQuery = await zcql.executeZCQLQuery(
                        `SELECT DISTINCT ContractorName FROM Employee WHERE ContractorName LIKE '%NAPS%' LIMIT 10`
                    );
                    if (napsQuery && napsQuery.length > 0) {
                        contractorName = napsQuery[0].Employee?.ContractorName;
                    } else {
                        contractorName = "NAPS";
                    }
                } catch (napsError) {
                    contractorName = "NAPS";
                }
            } else {
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
           
            // Get employee IDs for this contractor (active employees only)
            if (contractorName) {
                const escapedContractorName = contractorName.replace(/'/g, "''");
                
                let employeeQuery;
                if (contractorName.toLowerCase().includes('samuel')) {
                    employeeQuery = `SELECT ROWID FROM Employee WHERE ContractorName LIKE '%Samuel%' AND ${activeCondition}`;
                } else if (contractorName.toUpperCase().includes('NAPS')) {
                    employeeQuery = `SELECT ROWID FROM Employee WHERE ContractorName LIKE '%NAPS%' AND ${activeCondition}`;
                } else {
                    employeeQuery = `SELECT ROWID FROM Employee WHERE LOWER(ContractorName) = LOWER('${escapedContractorName}') AND ${activeCondition}`;
                }
                
                try {
                    const employeeRows = await zcql.executeZCQLQuery(employeeQuery);
                    employeeIds = employeeRows.map(row => row.Employee.ROWID);
                    console.log(`Filtering shift schedules for contractor: ${contractorName}, found ${employeeIds.length} employees`);
                } catch (error) {
                    console.error('Error fetching employees for contractor:', error);
                }
            }
        }
        
        const uniqueEmployees = {};
        
        if (isAppAdministrator) {
            // App Administrator: load active employees only from Employee table
            const empTablePageSize = 300;
            let empOffset = 0;
            let empHasMore = true;
            const empQuery = `SELECT EmployeeCode, EmployeeName, ContractorName FROM Employee WHERE EmployeeCode IS NOT NULL AND ${activeCondition}`;
            while (empHasMore) {
                try {
                    const q = `${empQuery} ORDER BY EmployeeCode LIMIT ${empTablePageSize} OFFSET ${empOffset}`;
                    const batch = await zcql.executeZCQLQuery(q);
                    if (batch.length === 0) break;
                    batch.forEach(row => {
                        const r = row.Employee || row;
                        const code = String(r.EmployeeCode || '').trim();
                        if (code && !uniqueEmployees[code]) {
                            uniqueEmployees[code] = {
                                employeeCode: r.EmployeeCode,
                                employeeName: r.EmployeeName || '',
                                contractor: r.ContractorName || r.Contractor || ''
                            };
                        }
                    });
                    if (batch.length < empTablePageSize) empHasMore = false;
                    else empOffset += empTablePageSize;
                    if (Object.keys(uniqueEmployees).length > 50000) break;
                } catch (empErr) {
                    console.error('Error fetching employees for App Administrator:', empErr.message);
                    empHasMore = false;
                }
            }
            console.log(`App Administrator: loaded ${Object.keys(uniqueEmployees).length} active employees from Employee table`);
        } else {
            // First, get all unique employees from NewShiftMap (to show all employees regardless of date range)
            let employeeCodeFilter = '';
            if (employeeIds.length > 0) {
                const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
                const employeeCodeQuery = `SELECT EmployeeCode FROM Employee WHERE ROWID IN (${employeeIdList})`;
                const employeeCodes = await zcql.executeZCQLQuery(employeeCodeQuery);
                const codes = employeeCodes.map(row => `'${String(row.Employee?.EmployeeCode || '').replace(/'/g, "''")}'`).filter(Boolean);
                if (codes.length > 0) {
                    employeeCodeFilter = ` WHERE EmployeeCode IN (${codes.join(',')})`;
                }
            }
            
            const allEmployeesBaseQuery = `SELECT DISTINCT EmployeeCode, EmployeeName, Contractor FROM NewShiftMap${employeeCodeFilter}`;
            const allEmployeesPageSize = 300;
            let allEmployeesOffset = 0;
            let allEmployeesHasMore = true;
            const allEmployeesRows = [];
            
            while (allEmployeesHasMore) {
                try {
                    const allEmployeesPaginatedQuery = `${allEmployeesBaseQuery} ORDER BY EmployeeCode LIMIT ${allEmployeesPageSize} OFFSET ${allEmployeesOffset}`;
                    const allEmployeesBatch = await zcql.executeZCQLQuery(allEmployeesPaginatedQuery);
                    if (allEmployeesBatch.length === 0) { allEmployeesHasMore = false; break; }
                    allEmployeesRows.push(...allEmployeesBatch);
                    if (allEmployeesBatch.length < allEmployeesPageSize) { allEmployeesHasMore = false; break; }
                    allEmployeesOffset += allEmployeesPageSize;
                    if (allEmployeesRows.length > 10000) { allEmployeesHasMore = false; }
                } catch (allEmployeesErr) {
                    try {
                        const allEmployees = await zcql.executeZCQLQuery(allEmployeesBaseQuery);
                        allEmployeesRows.push(...allEmployees);
                    } catch (queryErr) {
                        console.error('Error executing unique employees query without pagination:', queryErr);
                    }
                    allEmployeesHasMore = false;
                }
            }
            
            allEmployeesRows.forEach(row => {
                const empCode = String(row.NewShiftMap?.EmployeeCode || '').trim();
                if (empCode && !uniqueEmployees[empCode]) {
                    uniqueEmployees[empCode] = {
                        employeeCode: row.NewShiftMap.EmployeeCode,
                        employeeName: row.NewShiftMap.EmployeeName,
                        contractor: row.NewShiftMap.Contractor
                    };
                }
            });
            console.log(`Found ${Object.keys(uniqueEmployees).length} unique employees in NewShiftMap (from ${allEmployeesRows.length} rows)`);
            
            // Filter to active employees only (employeeStatus = 'Active' or EmployeeStatus = 'Active')
            let activeCodes = new Set();
            try {
                const activeQuery = `SELECT EmployeeCode FROM Employee WHERE ${activeCondition}`;
                const activePageSize = 300;
                let activeOffset = 0;
                let activeHasMore = true;
                while (activeHasMore) {
                    const q = `${activeQuery} ORDER BY EmployeeCode LIMIT ${activePageSize} OFFSET ${activeOffset}`;
                    const activeRows = await zcql.executeZCQLQuery(q);
                    if (activeRows.length === 0) break;
                    activeRows.forEach(row => {
                        const code = String(row.Employee?.EmployeeCode || '').trim();
                        if (code) activeCodes.add(code);
                    });
                    if (activeRows.length < activePageSize) activeHasMore = false;
                    else activeOffset += activePageSize;
                    if (activeCodes.size > 50000) break;
                }
                if (activeCodes.size > 0) {
                    const before = Object.keys(uniqueEmployees).length;
                    Object.keys(uniqueEmployees).forEach(code => {
                        if (!activeCodes.has(code)) delete uniqueEmployees[code];
                    });
                    console.log(`Filtered to active only: ${Object.keys(uniqueEmployees).length} employees (removed ${before - Object.keys(uniqueEmployees).length} inactive)`);
                }
            } catch (activeErr) {
                console.error('Error fetching active employees for filter:', activeErr.message);
            }
        }
        
        // Now get schedules for the date range with pagination to ensure all records are fetched
        let baseQuery = 'SELECT ROWID, EmployeeCode, EmployeeName, Contractor, ShiftDate, ShiftType, CREATEDTIME, MODIFIEDTIME FROM NewShiftMap';
        const conditions = [];
        
        // For App Administrator we fetch all schedules in date range (no employee filter). For others, filter by employee codes.
        if (!isAppAdministrator && Object.keys(uniqueEmployees).length > 0) {
            const codes = Object.keys(uniqueEmployees).map(code => `'${String(code).replace(/'/g, "''")}'`).filter(Boolean);
            if (codes.length > 0) {
                console.log(`Filtering schedules for ${codes.length} employee codes`);
                conditions.push(`EmployeeCode IN (${codes.join(',')})`);
            }
        } else if (isAppAdministrator) {
            console.log('App Administrator: fetching all schedules in date range (no employee filter)');
        }
        
        if (startDate) {
            conditions.push(`ShiftDate >= '${startDate}'`);
        }
        if (endDate) {
            conditions.push(`ShiftDate <= '${endDate}'`);
        }
        
        if (conditions.length > 0) {
            baseQuery += ' WHERE ' + conditions.join(' AND ');
        }
        
        baseQuery += ' ORDER BY EmployeeCode, ShiftDate';
        
        // Use pagination to fetch all records
        // ZCQL has a maximum LIMIT of 300, so we must use 300 or less
        const pageSize = 300; // ZCQL maximum is 300
        let offset = 0;
        let hasMore = true;
        const allRows = [];
        
        while (hasMore) {
            try {
                const paginatedQuery = `${baseQuery} LIMIT ${pageSize} OFFSET ${offset}`;
                console.log(`Fetching schedules: offset ${offset}, page size ${pageSize}`);
                const batch = await zcql.executeZCQLQuery(paginatedQuery);
                
                if (batch.length === 0) {
                    hasMore = false;
                    break;
                }
                
                allRows.push(...batch);
                console.log(`Fetched ${batch.length} schedule records in this batch (total so far: ${allRows.length})`);
                
                // If we got fewer records than page size, we've reached the end
                if (batch.length < pageSize) {
                    hasMore = false;
                    break;
                }
                
                offset += pageSize;
                
                // Safety limit to prevent infinite loops
                if (allRows.length > 100000) {
                    console.log('⚠️ Reached safety limit of 100000 schedule records, stopping pagination');
                    hasMore = false;
                }
            } catch (pagErr) {
                // If pagination fails, try without pagination (but this will also be limited to 300)
                console.log('Pagination failed, trying without pagination:', pagErr.message);
                try {
                    const rows = await zcql.executeZCQLQuery(baseQuery);
                    allRows.push(...rows);
                    console.log(`Fetched ${rows.length} schedule records without pagination`);
                } catch (queryErr) {
                    console.error('Error executing query without pagination:', queryErr);
                }
                hasMore = false;
            }
        }
        
        console.log(`Fetched ${allRows.length} total schedule records (paginated)`);
        
        const schedules = allRows.map(row => ({
            id: row.NewShiftMap.ROWID,
            employeeCode: row.NewShiftMap.EmployeeCode,
            employeeName: row.NewShiftMap.EmployeeName,
            contractor: row.NewShiftMap.Contractor,
            shiftDate: row.NewShiftMap.ShiftDate,
            shiftType: row.NewShiftMap.ShiftType,
            createdTime: row.NewShiftMap.CREATEDTIME,
            modifiedTime: row.NewShiftMap.MODIFIEDTIME
        }));
        
        // Count schedules per employee for debugging
        const schedulesPerEmployee = {};
        schedules.forEach(s => {
            const empCode = String(s.employeeCode || '').trim();
            if (empCode) {
                schedulesPerEmployee[empCode] = (schedulesPerEmployee[empCode] || 0) + 1;
            }
        });
        
        console.log(`Schedule records per employee: ${Object.keys(schedulesPerEmployee).length} employees have schedule data`);
        console.log(`Total unique employees in system: ${Object.keys(uniqueEmployees).length}`);
        
        // Log first few and last few employee codes with schedules for debugging
        const empCodesWithSchedules = Object.keys(schedulesPerEmployee).sort((a, b) => {
            const numA = parseInt(a) || 0;
            const numB = parseInt(b) || 0;
            return numA - numB;
        });
        if (empCodesWithSchedules.length > 0) {
            console.log(`First 5 employees with schedules: ${empCodesWithSchedules.slice(0, 5).join(', ')}`);
            console.log(`Last 5 employees with schedules: ${empCodesWithSchedules.slice(-5).join(', ')}`);
        }
        
        // Ensure all unique employees are represented in the schedules array
        // Add empty entries for employees that don't have data in the date range
        Object.keys(uniqueEmployees).forEach(empCode => {
            const hasDataInRange = schedules.some(s => String(s.employeeCode).trim() === empCode);
            if (!hasDataInRange) {
                // Employee exists in NewShiftMap but has no data for this date range
                // We'll still include them in the response so they show up in the table
                // The frontend will handle showing empty cells for dates without data
            }
        });
        
        console.log(`Returning ${schedules.length} schedule records for ${Object.keys(uniqueEmployees).length} employees`);
        
        res.status(200).send({ status: 'success', data: { schedules, uniqueEmployees: Object.values(uniqueEmployees) } });
    } catch (err) {
        console.error('Error fetching shift schedules:', err);
        res.status(500).send({ status: 'failure', message: "Couldn't fetch shift schedules." });
    }
});

// Add a new shift schedule record
app.post('/newshiftmaps', async (req, res) => {
    try {
        const { employeeCode, employeeName, contractor, shiftDate, shiftType } = req.body;
        if (!employeeCode || !shiftDate) {
            return res.status(400).send({ status: 'failure', message: 'EmployeeCode and ShiftDate are required.' });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('NewShiftMap');
        
        // Check for duplicate (same employee, same date)
        const zcql = catalyst.zcql();
        const duplicateQuery = `SELECT ROWID FROM NewShiftMap WHERE EmployeeCode = '${String(employeeCode).replace(/'/g, "''")}' AND ShiftDate = '${shiftDate}' LIMIT 1`;
        const duplicates = await zcql.executeZCQLQuery(duplicateQuery);
        
        if (duplicates.length > 0) {
            // Update existing record
            const existingId = duplicates[0].NewShiftMap.ROWID;
            const updatedRecord = await table.updateRow({
                ROWID: existingId,
                EmployeeCode: String(employeeCode).trim(),
                EmployeeName: employeeName ? String(employeeName).trim() : null,
                Contractor: contractor ? String(contractor).trim() : null,
                ShiftDate: shiftDate,
                ShiftType: shiftType ? String(shiftType).trim() : null
            });
            return res.status(200).send({
                status: 'success',
                message: 'Shift schedule updated.',
                data: {
                    schedule: {
                        id: updatedRecord.ROWID,
                        employeeCode: updatedRecord.EmployeeCode,
                        employeeName: updatedRecord.EmployeeName,
                        contractor: updatedRecord.Contractor,
                        shiftDate: updatedRecord.ShiftDate,
                        shiftType: updatedRecord.ShiftType,
                        createdTime: updatedRecord.CREATEDTIME,
                        modifiedTime: updatedRecord.MODIFIEDTIME
                    }
                }
            });
        }
        
        // Create new record
        const newRecord = await table.insertRow({
            EmployeeCode: String(employeeCode).trim(),
            EmployeeName: employeeName ? String(employeeName).trim() : null,
            Contractor: contractor ? String(contractor).trim() : null,
            ShiftDate: shiftDate,
            ShiftType: shiftType ? String(shiftType).trim() : null
        });
        res.status(200).send({
            status: 'success',
            data: {
                schedule: {
                    id: newRecord.ROWID,
                    employeeCode: newRecord.EmployeeCode,
                    employeeName: newRecord.EmployeeName,
                    contractor: newRecord.Contractor,
                    shiftDate: newRecord.ShiftDate,
                    shiftType: newRecord.ShiftType,
                    createdTime: newRecord.CREATEDTIME,
                    modifiedTime: newRecord.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        console.error('Error creating shift schedule:', err);
        res.status(400).send({ status: 'failure', message: err.message || 'Invalid input.' });
    }
});

// Helper function to process a batch of schedules
async function processBatch(batch, table, zcql) {
    const batchResults = {
        successful: 0,
        failed: 0,
        updated: 0,
        errors: []
    };
    
    // First, get all existing records for this batch in one query
    const employeeCodes = batch.map(s => String(s.employeeCode || '').replace(/'/g, "''")).filter(Boolean);
    const shiftDates = batch.map(s => s.shiftDate).filter(Boolean);
    
    let existingRecords = new Map();
    if (employeeCodes.length > 0 && shiftDates.length > 0) {
        try {
            // Build query to get existing records for this batch
            const codesList = employeeCodes.map(c => `'${c}'`).join(',');
            const datesList = shiftDates.map(d => `'${d}'`).join(',');
            const existingQuery = `SELECT ROWID, EmployeeCode, ShiftDate FROM NewShiftMap WHERE EmployeeCode IN (${codesList}) AND ShiftDate IN (${datesList})`;
            const existing = await zcql.executeZCQLQuery(existingQuery);
            
            // Create a map for quick lookup: key = "employeeCode_shiftDate"
            existing.forEach(row => {
                const key = `${row.NewShiftMap.EmployeeCode}_${row.NewShiftMap.ShiftDate}`;
                existingRecords.set(key, row.NewShiftMap.ROWID);
            });
        } catch (queryError) {
            console.error('Error fetching existing records:', queryError);
        }
    }
    
    // Process each record in the batch
    for (const schedule of batch) {
        try {
            const { employeeCode, employeeName, contractor, shiftDate, shiftType } = schedule;
            
            if (!employeeCode || !shiftDate) {
                batchResults.failed++;
                if (batchResults.errors.length < 10) {
                    batchResults.errors.push({
                        record: schedule,
                        error: 'EmployeeCode and ShiftDate are required'
                    });
                }
                continue;
            }
            
            const key = `${String(employeeCode).trim()}_${shiftDate}`;
            const existingId = existingRecords.get(key);
            
            if (existingId) {
                // Update existing
                await table.updateRow({
                    ROWID: existingId,
                    EmployeeCode: String(employeeCode).trim(),
                    EmployeeName: employeeName ? String(employeeName).trim() : null,
                    Contractor: contractor ? String(contractor).trim() : null,
                    ShiftDate: shiftDate,
                    ShiftType: shiftType ? String(shiftType).trim() : null
                });
                batchResults.updated++;
            } else {
                // Create new
                await table.insertRow({
                    EmployeeCode: String(employeeCode).trim(),
                    EmployeeName: employeeName ? String(employeeName).trim() : null,
                    Contractor: contractor ? String(contractor).trim() : null,
                    ShiftDate: shiftDate,
                    ShiftType: shiftType ? String(shiftType).trim() : null
                });
                batchResults.successful++;
            }
        } catch (recordError) {
            batchResults.failed++;
            if (batchResults.errors.length < 10) {
                batchResults.errors.push({
                    record: schedule,
                    error: recordError.message || 'Unknown error'
                });
            }
        }
    }
    
    return batchResults;
}

// Bulk import shift schedules
app.post('/newshiftmaps/bulk-import', async (req, res) => {
    try {
        const { schedules } = req.body;
        if (!Array.isArray(schedules) || schedules.length === 0) {
            return res.status(400).send({ status: 'failure', message: 'Schedules array is required.' });
        }
        
        console.log(`Bulk import started: ${schedules.length} records to process`);
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('NewShiftMap');
        const zcql = catalyst.zcql();
        
        const results = {
            successful: 0,
            failed: 0,
            updated: 0,
            errors: []
        };
        
        // Process in smaller batches with parallel processing
        const batchSize = 50; // Reduced batch size for faster processing
        const totalBatches = Math.ceil(schedules.length / batchSize);
        const concurrencyLimit = 3; // Process 3 batches in parallel
        
        // Process batches with concurrency limit
        for (let i = 0; i < totalBatches; i += concurrencyLimit) {
            const batchPromises = [];
            
            for (let j = 0; j < concurrencyLimit && (i + j) < totalBatches; j++) {
                const batchIndex = i + j;
                const startIndex = batchIndex * batchSize;
                const endIndex = Math.min(startIndex + batchSize, schedules.length);
                const batch = schedules.slice(startIndex, endIndex);
                
                console.log(`Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} records)`);
                
                batchPromises.push(processBatch(batch, table, zcql));
            }
            
            // Wait for all batches in this group to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Aggregate results
            batchResults.forEach(batchResult => {
                results.successful += batchResult.successful;
                results.failed += batchResult.failed;
                results.updated += batchResult.updated;
                if (results.errors.length < 10) {
                    results.errors.push(...batchResult.errors.slice(0, 10 - results.errors.length));
                }
            });
        }
        
        console.log(`Bulk import completed: ${results.successful} created, ${results.updated} updated, ${results.failed} failed`);
        
        res.status(200).send({
            status: 'success',
            data: results
        });
    } catch (err) {
        console.error('Error in bulk import:', err);
        res.status(500).send({ status: 'failure', message: err.message || 'Bulk import failed.' });
    }
});

// Update a shift schedule record
app.put('/newshiftmaps/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeCode, employeeName, contractor, shiftDate, shiftType } = req.body;
        if (!employeeCode || !shiftDate) {
            return res.status(400).send({ status: 'failure', message: 'EmployeeCode and ShiftDate are required.' });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('NewShiftMap');
        const updatedRecord = await table.updateRow({
            ROWID: id,
            EmployeeCode: String(employeeCode).trim(),
            EmployeeName: employeeName ? String(employeeName).trim() : null,
            Contractor: contractor ? String(contractor).trim() : null,
            ShiftDate: shiftDate,
            ShiftType: shiftType ? String(shiftType).trim() : null
        });
        res.status(200).send({
            status: 'success',
            data: {
                schedule: {
                    id: updatedRecord.ROWID,
                    employeeCode: updatedRecord.EmployeeCode,
                    employeeName: updatedRecord.EmployeeName,
                    contractor: updatedRecord.Contractor,
                    shiftDate: updatedRecord.ShiftDate,
                    shiftType: updatedRecord.ShiftType,
                    createdTime: updatedRecord.CREATEDTIME,
                    modifiedTime: updatedRecord.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        console.error('Error updating shift schedule:', err);
        res.status(400).send({ status: 'failure', message: err.message || 'Invalid input.' });
    }
});

// Delete a shift schedule record
app.delete('/newshiftmaps/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('NewShiftMap');
        await table.deleteRow(id);
        res.status(200).send({ status: 'success', message: 'Shift schedule deleted.' });
    } catch (err) {
        console.error('Error deleting shift schedule:', err);
        res.status(500).send({ status: 'failure', message: "Couldn't delete shift schedule." });
    }
});

// Delete multiple shift schedule records
app.delete('/newshiftmaps', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).send({ status: 'failure', message: 'IDs array is required.' });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('NewShiftMap');
        const results = { successful: 0, failed: 0, errors: [] };
        
        for (const id of ids) {
            try {
                await table.deleteRow(id);
                results.successful++;
            } catch (err) {
                results.failed++;
                results.errors.push({ id, error: err.message });
            }
        }
        
        res.status(200).send({ status: 'success', data: results });
    } catch (err) {
        console.error('Error deleting shift schedules:', err);
        res.status(500).send({ status: 'failure', message: "Couldn't delete shift schedules." });
    }
});

module.exports = app;
