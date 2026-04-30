const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Note: calculateTotalHoursFromTimes function removed as per user request
// TotalHours and Overtime calculations have been removed from the attendance import system

// Root endpoint - handle POST requests to /
app.post('/', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        const zcql = catalyst.zcql();
        
        // Debug: Log the received data
        console.log('=== DEBUG: Received data ===');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('Request headers:', req.headers);
        console.log('Data type:', typeof req.body);
        console.log('Is array:', Array.isArray(req.body));
        console.log('================================');
        
        // Check if it's a single record or bulk import
        const data = req.body;
        
        // Handle the specific format: { attendanceData: [...] }
        if (data && data.attendanceData && Array.isArray(data.attendanceData)) {
            console.log('Detected attendanceData array format');
            return await handleAttendanceDataArray(req, res, table, zcql, data.attendanceData);
        } else if (Array.isArray(data)) {
            // Bulk import
            return await handleBulkImport(req, res, table, zcql);
        } else if (data && typeof data === 'object') {
            // Single record import
            return await handleSingleImport(req, res, table, zcql);
        } else {
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid data format. Expected object or array.',
                debug: {
                    receivedType: typeof data,
                    receivedData: data
                }
            });
        }
    } catch (err) {
        console.log('Root endpoint error:', err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Invalid input provided.',
            debug: {
                error: err.message,
                stack: err.stack
            }
        });
    }
});

// Helper function for attendanceData array format - OPTIMIZED VERSION
async function handleAttendanceDataArray(req, res, table, zcql, attendanceDataArray) {
    console.log('=== DEBUG: AttendanceData Array Handler (OPTIMIZED) ===');
    console.log('Processing', attendanceDataArray.length, 'records');
    console.log('First record:', attendanceDataArray[0]);
    console.log('==========================================');
    
    const results = {
        total: attendanceDataArray.length,
        successful: 0,
        failed: 0,
        duplicates: 0,
        errors: []
    };
    
    // Step 1: Pre-process and validate all records
    const validRecords = [];
    const recordMap = new Map(); // For tracking processed records
    
    for (const record of attendanceDataArray) {
        try {
            // Map the fields from your frontend format to database format
            const employeeId = record.EmployeeID || record.EmployeeId || record.employeeId;
            let attendanceDate = record.Date || record.AttendanceDate || record.attendanceDate;
            const firstIn = record.FirstIN || record.FirstIn || record.firstIn;
            const lastOut = record.LastOUT || record.LastOut || record.lastOut;
            const status = record.Status || record.status;
            
            // Convert date format from DD-MM-YYYY to YYYY-MM-DD
            if (attendanceDate) {
                attendanceDate = convertDateFormat(attendanceDate);
            }
            
            // Validate required fields
            if (!employeeId || !attendanceDate) {
                results.failed++;
                results.errors.push({
                    record: record,
                    error: 'EmployeeID and Date are required'
                });
                continue;
            }
            
            // Check for duplicates within the batch itself
            const recordKey = `${employeeId}-${attendanceDate}`;
            if (recordMap.has(recordKey)) {
                results.duplicates++;
                console.log('Duplicate within batch for:', employeeId, attendanceDate);
                continue;
            }
            recordMap.set(recordKey, true);
            
            // Prepare insert data
            const insertData = {
                EmployeeId: employeeId.toString().trim(),
                AttendanceDate: attendanceDate.toString().trim()
            };
            
            if (firstIn && firstIn.toString().trim()) {
                insertData.FirstIn = firstIn.toString().trim();
            }
            if (lastOut && lastOut.toString().trim()) {
                insertData.LastOut = lastOut.toString().trim();
            }
            if (status && status.toString().trim()) {
                insertData.Status = status.toString().trim();
            }
            
            validRecords.push(insertData);
            
        } catch (recordError) {
            console.error('Error processing record:', recordError);
            results.failed++;
            results.errors.push({
                record: record,
                error: recordError.message
            });
        }
    }
    
    if (validRecords.length === 0) {
        console.log('No valid records to process');
        return res.status(200).send({
            status: 'success',
            message: 'No valid records to import',
            data: { results }
        });
    }
    
    // Step 2: Batch check for existing records in database
    console.log(`Checking for existing records in database for ${validRecords.length} valid records`);
    const existingRecords = await batchCheckDuplicates(zcql, validRecords);
    const existingKeys = new Set(existingRecords.map(r => `${r.EmployeeId}-${r.AttendanceDate}`));
    
    // Step 3: Filter out existing records and prepare for batch insert
    const recordsToInsert = validRecords.filter(record => {
        const key = `${record.EmployeeId}-${record.AttendanceDate}`;
        if (existingKeys.has(key)) {
            results.duplicates++;
            return false;
        }
        return true;
    });
    
    console.log(`Found ${existingRecords.length} existing records, ${recordsToInsert.length} new records to insert`);
    
    // Step 4: Batch insert remaining records
    if (recordsToInsert.length > 0) {
        try {
            console.log('Starting batch insert...');
            const insertPromises = recordsToInsert.map(record => table.insertRow(record));
            const insertResults = await Promise.all(insertPromises);
            results.successful = insertResults.length;
            console.log(`Successfully inserted ${insertResults.length} records`);
        } catch (insertError) {
            console.error('Batch insert failed:', insertError);
            // Fallback to individual inserts
            console.log('Falling back to individual inserts...');
            for (const record of recordsToInsert) {
                try {
                    await table.insertRow(record);
                    results.successful++;
                } catch (individualError) {
                    results.failed++;
                    results.errors.push({
                        record: record,
                        error: individualError.message
                    });
                }
            }
        }
    }
    
    console.log('Final results:', results);
    
    res.status(200).send({
        status: 'success',
        message: 'Attendance data import completed',
        data: { results }
    });
}

// Helper function to batch check for duplicates
async function batchCheckDuplicates(zcql, records) {
    if (records.length === 0) return [];
    
    try {
        // Create a batch query to check for existing records
        const conditions = records.map(record => 
            `(EmployeeId = '${record.EmployeeId}' AND AttendanceDate = '${record.AttendanceDate}')`
        ).join(' OR ');
        
        const batchQuery = `
            SELECT EmployeeId, AttendanceDate 
            FROM Attendance 
            WHERE ${conditions}
            LIMIT 300
        `;
        
        console.log('Batch duplicate check query:', batchQuery);
        const existingRecords = await zcql.executeZCQLQuery(batchQuery);
        return existingRecords.map(row => row.Attendance);
        
    } catch (error) {
        console.error('Batch duplicate check failed:', error);
        // Fallback to individual checks if batch query fails
        const existingRecords = [];
        for (const record of records) {
            try {
                const duplicateQuery = `
                    SELECT EmployeeId, AttendanceDate FROM Attendance 
                    WHERE EmployeeId = '${record.EmployeeId}' 
                    AND AttendanceDate = '${record.AttendanceDate}'
                    LIMIT 1
                `;
                const result = await zcql.executeZCQLQuery(duplicateQuery);
                if (result.length > 0) {
                    existingRecords.push(result[0].Attendance);
                }
            } catch (individualError) {
                console.error('Individual duplicate check failed:', individualError);
            }
        }
        return existingRecords;
    }
}

// Helper function for single record import
async function handleSingleImport(req, res, table, zcql) {
    console.log('=== DEBUG: Single Import Function ===');
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body values:', req.body);
    console.log('=====================================');
    
    const { employeeId, attendanceDate, firstIn, lastOut, status } = req.body;
    
    // Also try alternative field names that might be used
    const altEmployeeId = req.body.EmployeeId || req.body.employee_id || req.body.EMPLOYEE_ID;
    const altAttendanceDate = req.body.AttendanceDate || req.body.attendance_date || req.body.ATTENDANCE_DATE;
    
    console.log('Extracted fields:');
    console.log('- employeeId:', employeeId);
    console.log('- attendanceDate:', attendanceDate);
    console.log('- altEmployeeId:', altEmployeeId);
    console.log('- altAttendanceDate:', altAttendanceDate);
    
    const finalEmployeeId = employeeId || altEmployeeId;
    const finalAttendanceDate = attendanceDate || altAttendanceDate;
    
    if (!finalEmployeeId || !finalAttendanceDate) {
        return res.status(400).send({
            status: 'failure',
            message: 'EmployeeId and AttendanceDate are required.',
            debug: {
                receivedFields: Object.keys(req.body),
                employeeId: finalEmployeeId,
                attendanceDate: finalAttendanceDate,
                allFields: req.body
            }
        });
    }
    
    // Check for duplicate attendance record
    const duplicateQuery = `
        SELECT ROWID FROM Attendance 
        WHERE EmployeeId = '${finalEmployeeId}' 
        AND AttendanceDate = '${finalAttendanceDate}'
        LIMIT 1
    `;
    const duplicateResult = await zcql.executeZCQLQuery(duplicateQuery);
    
    if (duplicateResult.length > 0) {
        return res.status(409).send({
            status: 'failure',
            message: 'Attendance record already exists for this employee on this date.'
        });
    }
    
    // Prepare insert data
    const insertData = {
        EmployeeId: finalEmployeeId.toString().trim(),
        AttendanceDate: finalAttendanceDate.toString().trim()
    };
    
    // Handle other fields with flexible mapping
    const firstInValue = firstIn || req.body.FirstIn || req.body.first_in || req.body.FIRST_IN;
    const lastOutValue = lastOut || req.body.LastOut || req.body.last_out || req.body.LAST_OUT;
    const statusValue = status || req.body.Status || req.body.status || req.body.STATUS;
    
    if (firstInValue && firstInValue.toString().trim()) {
        insertData.FirstIn = firstInValue.toString().trim();
    }
    if (lastOutValue && lastOutValue.toString().trim()) {
        insertData.LastOut = lastOutValue.toString().trim();
    }
    
    if (statusValue && statusValue.toString().trim()) {
        insertData.Status = statusValue.toString().trim();
    }
    
    console.log('Final insert data:', insertData);
    
    const newAttendance = await table.insertRow(insertData);
    
        res.status(200).send({
            status: 'success',
            data: {
                attendance: {
                    id: newAttendance.ROWID,
                    employeeId: newAttendance.EmployeeId,
                    attendanceDate: newAttendance.AttendanceDate,
                    firstIn: newAttendance.FirstIn,
                    lastOut: newAttendance.LastOut,
                    status: newAttendance.Status,
                    createdTime: newAttendance.CREATEDTIME,
                    modifiedTime: newAttendance.MODIFIEDTIME
                }
            }
        });
}

// Helper function for bulk import
async function handleBulkImport(req, res, table, zcql) {
    const data = req.body;
    
    if (!data || !Array.isArray(data)) {
        return res.status(400).send({
            status: 'failure',
            message: 'Data array is required for bulk import.'
        });
    }
    
    const results = {
        total: data.length,
        successful: 0,
        failed: 0,
        duplicates: 0,
        errors: []
    };
    
    // Process records in batches
    const batchSize = 10;
    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        
        for (const record of batch) {
            try {
                const { employeeId, attendanceDate, firstIn, lastOut, status } = record;
                
                // Validate required fields
                if (!employeeId || !attendanceDate) {
                    results.failed++;
                    results.errors.push({
                        record: record,
                        error: 'EmployeeId and AttendanceDate are required'
                    });
                    continue;
                }
                
                // Check for duplicate
                const duplicateQuery = `
                    SELECT ROWID FROM Attendance 
                    WHERE EmployeeId = '${employeeId}' 
                    AND AttendanceDate = '${attendanceDate}'
                    LIMIT 1
                `;
                const duplicateResult = await zcql.executeZCQLQuery(duplicateQuery);
                
                if (duplicateResult.length > 0) {
                    results.duplicates++;
                    continue;
                }
                
                // Prepare insert data
                const insertData = {
                    EmployeeId: employeeId.trim(),
                    AttendanceDate: attendanceDate.trim()
                };
                
                if (firstIn && firstIn.trim()) {
                    insertData.FirstIn = firstIn.trim();
                }
                if (lastOut && lastOut.trim()) {
                    insertData.LastOut = lastOut.trim();
                }
                
                if (status && status.trim()) {
                    insertData.Status = status.trim();
                }
                
                await table.insertRow(insertData);
                results.successful++;
                
            } catch (recordError) {
                results.failed++;
                results.errors.push({
                    record: record,
                    error: recordError.message
                });
            }
        }
        
        // Small delay between batches
        if (i + batchSize < data.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    res.status(200).send({
        status: 'success',
        message: 'Bulk import completed',
        data: { results }
    });
}

// GET API: Get attendance count
app.get('/attendance/count', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        const allRows = await table.getAllRows();
        res.json({ count: allRows.length });
    } catch (err) {
        console.error('Attendance count error:', err);
        res.status(500).json({ error: 'Failed to get attendance count' });
    }
});

// GET API: Get all attendance records with pagination
app.get('/attendance', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        const employeeId = req.query.employeeId;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        
        const zcql = catalyst.zcql();
        
        // Build WHERE conditions
        let whereConditions = [];
        if (employeeId) {
            whereConditions.push(`EmployeeId = '${employeeId}'`);
        }
        if (startDate && endDate) {
            whereConditions.push(`AttendanceDate >= '${startDate}' AND AttendanceDate <= '${endDate}'`);
        }
        
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        
        // Get total count for pagination (with LIMIT to prevent 300+ row error)
        const countQuery = `SELECT COUNT(ROWID) as count FROM Attendance ${whereClause} LIMIT 1`;
        const countRows = await zcql.executeZCQLQuery(countQuery);
        const total = parseInt(countRows[0].Attendance.count);
        
        // Get paginated data (ensure perPage doesn't exceed 300)
        const offset = (page - 1) * perPage;
        const safePerPage = Math.min(perPage, 300); // Prevent exceeding ZCQL 300 row limit
        const query = `
            SELECT ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME, EmployeeId, AttendanceDate, FirstIn, LastOut, Status 
            FROM Attendance 
            ${whereClause}
            ORDER BY ROWID DESC 
            LIMIT ${offset},${safePerPage}
        `;
        
        let rows;
        try {
            rows = await zcql.executeZCQLQuery(query);
        } catch (zcqlError) {
            if (zcqlError.message && zcqlError.message.includes('300 ROWS in LIMIT')) {
                return res.status(400).send({
                    status: 'failure',
                    message: 'Query would return more than 300 rows. Please use smaller page size or add more filters.',
                    error: 'ZCQL_ROW_LIMIT_EXCEEDED',
                    suggestion: 'Try reducing perPage parameter to 50 or less'
                });
            }
            throw zcqlError;
        }
        
        const attendanceRecords = rows.map(row => ({
            id: row.Attendance.ROWID,
            employeeId: row.Attendance.EmployeeId,
            attendanceDate: row.Attendance.AttendanceDate,
            firstIn: row.Attendance.FirstIn,
            lastOut: row.Attendance.LastOut,
            status: row.Attendance.Status,
            createdTime: row.Attendance.CREATEDTIME,
            modifiedTime: row.Attendance.MODIFIEDTIME
        }));
        
        // Debug logging to help identify the issue
        console.log('=== ATTENDANCE API DEBUG ===');
        console.log('Query executed:', query);
        console.log('Total records found:', total);
        console.log('Records returned:', attendanceRecords.length);
        if (attendanceRecords.length > 0) {
            console.log('Sample record:', attendanceRecords[0]);
            console.log('FirstIn value:', attendanceRecords[0].firstIn);
            console.log('FirstIn type:', typeof attendanceRecords[0].firstIn);
        }
        console.log('============================');
        
        res.status(200).send({
            status: 'success',
            data: { 
                attendanceRecords,
                hasMore: page * perPage < total,
                total: total,
                page: page,
                perPage: perPage
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

// POST API: Ultra-fast single record import (no duplicate checking)
app.post('/attendance/fast-import', async (req, res) => {
    try {
        const { employeeId, attendanceDate, firstIn, lastOut, status } = req.body;
        
        if (!employeeId || !attendanceDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'EmployeeId and AttendanceDate are required.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        
        // Prepare insert data
        const insertData = {
            EmployeeId: employeeId.trim(),
            AttendanceDate: attendanceDate.trim()
        };
        
        if (firstIn && firstIn.trim()) {
            insertData.FirstIn = firstIn.trim();
        }
        if (lastOut && lastOut.trim()) {
            insertData.LastOut = lastOut.trim();
        }
        if (status && status.trim()) {
            insertData.Status = status.trim();
        }
        
        const newAttendance = await table.insertRow(insertData);
        
        res.status(200).send({
            status: 'success',
            data: {
                attendance: {
                    id: newAttendance.ROWID,
                    employeeId: newAttendance.EmployeeId,
                    attendanceDate: newAttendance.AttendanceDate,
                    firstIn: newAttendance.FirstIn,
                    lastOut: newAttendance.LastOut,
                    status: newAttendance.Status,
                    createdTime: newAttendance.CREATEDTIME,
                    modifiedTime: newAttendance.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Fast import failed.'
        });
    }
});

// POST API: Add a new attendance record
app.post('/attendance', async (req, res) => {
    try {
        const { employeeId, attendanceDate, firstIn, lastOut, status } = req.body;
        
        if (!employeeId || !attendanceDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'EmployeeId and AttendanceDate are required.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        const zcql = catalyst.zcql();
        
        // Check for duplicate attendance record
        const duplicateQuery = `
            SELECT ROWID FROM Attendance 
            WHERE EmployeeId = '${employeeId}' 
            AND AttendanceDate = '${attendanceDate}'
            LIMIT 1
        `;
        const duplicateResult = await zcql.executeZCQLQuery(duplicateQuery);
        
        if (duplicateResult.length > 0) {
            return res.status(409).send({
                status: 'failure',
                message: 'Attendance record already exists for this employee on this date.'
            });
        }
        
        // Prepare insert data
        const insertData = {
            EmployeeId: employeeId.trim(),
            AttendanceDate: attendanceDate.trim()
        };
        
        if (firstIn && firstIn.trim()) {
            insertData.FirstIn = firstIn.trim();
        }
        if (lastOut && lastOut.trim()) {
            insertData.LastOut = lastOut.trim();
        }
        if (status && status.trim()) {
            insertData.Status = status.trim();
        }
        
        const newAttendance = await table.insertRow(insertData);
        
        res.status(200).send({
            status: 'success',
            data: {
                attendance: {
                    id: newAttendance.ROWID,
                    employeeId: newAttendance.EmployeeId,
                    attendanceDate: newAttendance.AttendanceDate,
                    firstIn: newAttendance.FirstIn,
                    lastOut: newAttendance.LastOut,
                    status: newAttendance.Status,
                    createdTime: newAttendance.CREATEDTIME,
                    modifiedTime: newAttendance.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Invalid input provided.'
        });
    }
});

// POST API: Large batch import with proper chunking to avoid 300-row limit - OPTIMIZED VERSION
app.post('/attendance/bulk-import-safe', async (req, res) => {
    try {
        const { data, chunkSize = 25 } = req.body; // Reduced default chunk size for better performance
        
        if (!data || !Array.isArray(data)) {
            return res.status(400).send({
                status: 'failure',
                message: 'Data array is required for bulk import.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        const zcql = catalyst.zcql();
        
        const results = {
            total: data.length,
            successful: 0,
            failed: 0,
            duplicates: 0,
            errors: []
        };
        
        // Process records in smaller chunks to avoid ZCQL 300-row limit and execution timeout
        const safeChunkSize = Math.min(chunkSize, 25); // Keep chunks very small for better performance
        console.log(`Processing ${data.length} records in chunks of ${safeChunkSize}`);
        
        for (let i = 0; i < data.length; i += safeChunkSize) {
            const batch = data.slice(i, i + safeChunkSize);
            console.log(`Processing batch ${Math.floor(i/safeChunkSize) + 1}/${Math.ceil(data.length/safeChunkSize)}`);
            
            // Process batch using optimized approach
            const batchResults = await processBatchOptimized(batch, table, zcql);
            
            // Aggregate results
            results.successful += batchResults.successful;
            results.failed += batchResults.failed;
            results.duplicates += batchResults.duplicates;
            results.errors.push(...batchResults.errors);
            
            // Small delay between chunks to prevent overwhelming the server
            if (i + safeChunkSize < data.length) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Reduced delay
            }
        }
        
        res.status(200).send({
            status: 'success',
            message: 'Safe bulk import completed',
            data: { results }
        });
        
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Safe bulk import failed.'
        });
    }
});

// Helper function to process a batch of records efficiently
async function processBatchOptimized(batch, table, zcql) {
    const batchResults = {
        successful: 0,
        failed: 0,
        duplicates: 0,
        errors: []
    };
    
    // Step 1: Pre-process and validate all records in the batch
    const validRecords = [];
    const recordMap = new Map();
    
    for (const record of batch) {
        try {
            const { employeeId, attendanceDate, firstIn, lastOut, status } = record;
            
            // Validate required fields
            if (!employeeId || !attendanceDate) {
                batchResults.failed++;
                batchResults.errors.push({
                    record: record,
                    error: 'EmployeeId and AttendanceDate are required'
                });
                continue;
            }
            
            // Check for duplicates within the batch
            const recordKey = `${employeeId}-${attendanceDate}`;
            if (recordMap.has(recordKey)) {
                batchResults.duplicates++;
                continue;
            }
            recordMap.set(recordKey, true);
            
            // Prepare insert data
            const insertData = {
                EmployeeId: employeeId.trim(),
                AttendanceDate: attendanceDate.trim()
            };
            
            if (firstIn && firstIn.trim()) {
                insertData.FirstIn = firstIn.trim();
            }
            if (lastOut && lastOut.trim()) {
                insertData.LastOut = lastOut.trim();
            }
            if (status && status.trim()) {
                insertData.Status = status.trim();
            }
            
            validRecords.push(insertData);
            
        } catch (recordError) {
            batchResults.failed++;
            batchResults.errors.push({
                record: record,
                error: recordError.message
            });
        }
    }
    
    if (validRecords.length === 0) {
        return batchResults;
    }
    
    // Step 2: Batch check for existing records
    const existingRecords = await batchCheckDuplicates(zcql, validRecords);
    const existingKeys = new Set(existingRecords.map(r => `${r.EmployeeId}-${r.AttendanceDate}`));
    
    // Step 3: Filter out existing records
    const recordsToInsert = validRecords.filter(record => {
        const key = `${record.EmployeeId}-${record.AttendanceDate}`;
        if (existingKeys.has(key)) {
            batchResults.duplicates++;
            return false;
        }
        return true;
    });
    
    // Step 4: Batch insert remaining records
    if (recordsToInsert.length > 0) {
        try {
            const insertPromises = recordsToInsert.map(record => table.insertRow(record));
            await Promise.all(insertPromises);
            batchResults.successful = recordsToInsert.length;
        } catch (insertError) {
            console.error('Batch insert failed, falling back to individual inserts:', insertError);
            // Fallback to individual inserts
            for (const record of recordsToInsert) {
                try {
                    await table.insertRow(record);
                    batchResults.successful++;
                } catch (individualError) {
                    batchResults.failed++;
                    batchResults.errors.push({
                        record: record,
                        error: individualError.message
                    });
                }
            }
        }
    }
    
    return batchResults;
}

// POST API: Bulk import attendance records
app.post('/attendance/bulk-import', async (req, res) => {
    try {
        const { data } = req.body;
        
        if (!data || !Array.isArray(data)) {
            return res.status(400).send({
                status: 'failure',
                message: 'Data array is required for bulk import.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        const zcql = catalyst.zcql();
        
        const results = {
            total: data.length,
            successful: 0,
            failed: 0,
            duplicates: 0,
            errors: []
        };
        
        // Process records in batches
        const batchSize = 10;
        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);
            
            for (const record of batch) {
                try {
                    const { employeeId, attendanceDate, firstIn, lastOut, status } = record;
                    
                    // Validate required fields
                    if (!employeeId || !attendanceDate) {
                        results.failed++;
                        results.errors.push({
                            record: record,
                            error: 'EmployeeId and AttendanceDate are required'
                        });
                        continue;
                    }
                    
                    // Check for duplicate
                    const duplicateQuery = `
                        SELECT ROWID FROM Attendance 
                        WHERE EmployeeId = '${employeeId}' 
                        AND AttendanceDate = '${attendanceDate}'
                        LIMIT 1
                    `;
                    const duplicateResult = await zcql.executeZCQLQuery(duplicateQuery);
                    
                    if (duplicateResult.length > 0) {
                        results.duplicates++;
                        continue;
                    }
                    
                    // Prepare insert data
                    const insertData = {
                        EmployeeId: employeeId.trim(),
                        AttendanceDate: attendanceDate.trim()
                    };
                    
                    if (firstIn && firstIn.trim()) {
                        insertData.FirstIn = firstIn.trim();
                    }
                    if (lastOut && lastOut.trim()) {
                        insertData.LastOut = lastOut.trim();
                    }
                    if (status && status.trim()) {
                        insertData.Status = status.trim();
                    }
                    
                    await table.insertRow(insertData);
                    results.successful++;
                    
                } catch (recordError) {
                    results.failed++;
                    results.errors.push({
                        record: record,
                        error: recordError.message
                    });
                }
            }
            
            // Small delay between batches
            if (i + batchSize < data.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        res.status(200).send({
            status: 'success',
            message: 'Bulk import completed',
            data: { results }
        });
        
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Bulk import failed.'
        });
    }
});

// PUT API: Update an attendance record
app.put('/attendance/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeId, attendanceDate, firstIn, lastOut, status } = req.body;
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        
        // Prepare update data
        const updateData = { ROWID: id };
        
        if (employeeId && employeeId.trim()) {
            updateData.EmployeeId = employeeId.trim();
        }
        if (attendanceDate && attendanceDate.trim()) {
            updateData.AttendanceDate = attendanceDate.trim();
        }
        if (firstIn && firstIn.trim()) {
            updateData.FirstIn = firstIn.trim();
        }
        if (lastOut && lastOut.trim()) {
            updateData.LastOut = lastOut.trim();
        }
        if (status && status.trim()) {
            updateData.Status = status.trim();
        }
        
        // Only proceed if we have at least one field to update
        if (Object.keys(updateData).length === 1) { // Only ROWID
            return res.status(400).send({
                status: 'failure',
                message: 'At least one field must have data to update.'
            });
        }
        
        const updatedAttendance = await table.updateRow(updateData);
        
        res.status(200).send({
            status: 'success',
            data: {
                attendance: {
                    id: updatedAttendance.ROWID,
                    employeeId: updatedAttendance.EmployeeId,
                    attendanceDate: updatedAttendance.AttendanceDate,
                    firstIn: updatedAttendance.FirstIn,
                    lastOut: updatedAttendance.LastOut,
                    status: updatedAttendance.Status,
                    createdTime: updatedAttendance.CREATEDTIME,
                    modifiedTime: updatedAttendance.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Invalid input provided.'
        });
    }
});

// DELETE API: Delete an attendance record
app.delete('/attendance/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        await table.deleteRow(id);
        
        res.status(200).send({
            status: 'success',
            message: 'Attendance record deleted successfully.'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// GET API: Search attendance records
app.get('/attendance/search', async (req, res) => {
    try {
        const { q: searchTerm, page = 1, perPage = 50 } = req.query;
        
        if (!searchTerm) {
            return res.status(400).send({
                status: 'failure',
                message: 'Search term is required.'
            });
        }
        
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        
        const offset = (parseInt(page) - 1) * parseInt(perPage);
        
        const safePerPage = Math.min(parseInt(perPage), 300); // Prevent exceeding ZCQL 300 row limit
        const query = `
            SELECT ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME, EmployeeId, AttendanceDate, FirstIn, LastOut, Status 
            FROM Attendance 
            WHERE EmployeeId LIKE '%${searchTerm}%' 
            OR Status LIKE '%${searchTerm}%'
            ORDER BY ROWID DESC 
            LIMIT ${offset},${safePerPage}
        `;
        
        const countQuery = `
            SELECT COUNT(ROWID) as count FROM Attendance 
            WHERE EmployeeId LIKE '%${searchTerm}%' 
            OR Status LIKE '%${searchTerm}%'
            LIMIT 1
        `;
        
        let rows, countRows;
        try {
            rows = await zcql.executeZCQLQuery(query);
            countRows = await zcql.executeZCQLQuery(countQuery);
        } catch (zcqlError) {
            if (zcqlError.message && zcqlError.message.includes('300 ROWS in LIMIT')) {
                return res.status(400).send({
                    status: 'failure',
                    message: 'Search query would return more than 300 rows. Please use smaller page size or refine your search.',
                    error: 'ZCQL_ROW_LIMIT_EXCEEDED',
                    suggestion: 'Try reducing perPage parameter to 50 or less'
                });
            }
            throw zcqlError;
        }
        
        const total = parseInt(countRows[0].Attendance.count);
        
        const attendanceRecords = rows.map(row => ({
            id: row.Attendance.ROWID,
            employeeId: row.Attendance.EmployeeId,
            attendanceDate: row.Attendance.AttendanceDate,
            firstIn: row.Attendance.FirstIn,
            lastOut: row.Attendance.LastOut,
            status: row.Attendance.Status,
            createdTime: row.Attendance.CREATEDTIME,
            modifiedTime: row.Attendance.MODIFIEDTIME
        }));
        
        res.status(200).send({
            status: 'success',
            data: { 
                attendanceRecords,
                hasMore: page * perPage < total,
                total: total,
                page: parseInt(page),
                perPage: parseInt(perPage),
                searchTerm: searchTerm
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

// GET API: Debug endpoint to check today's attendance data
app.get('/attendance/debug', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        
        console.log('=== DEBUG ENDPOINT: Checking today\'s attendance data ===');
        console.log('Today\'s date:', today);
        
        // Query for today's attendance records (with LIMIT to prevent 300+ row error)
        const query = `
            SELECT ROWID, EmployeeId, AttendanceDate, FirstIn, LastOut, Status, CREATEDTIME, MODIFIEDTIME 
            FROM Attendance 
            WHERE AttendanceDate = '${today}'
            ORDER BY ROWID DESC
            LIMIT 300
        `;
        
        console.log('Debug query:', query);
        const rows = await zcql.executeZCQLQuery(query);
        console.log('Debug query results:', rows.length, 'records');
        
        const attendanceRecords = rows.map(row => ({
            id: row.Attendance.ROWID,
            employeeId: row.Attendance.EmployeeId,
            attendanceDate: row.Attendance.AttendanceDate,
            firstIn: row.Attendance.FirstIn,
            lastOut: row.Attendance.LastOut,
            status: row.Attendance.Status,
            createdTime: row.Attendance.CREATEDTIME,
            modifiedTime: row.Attendance.MODIFIEDTIME
        }));
        
        console.log('Processed records:', attendanceRecords);
        
        // Count records with FirstIn
        const recordsWithFirstIn = attendanceRecords.filter(record => record.firstIn && record.firstIn.trim() !== '');
        console.log('Records with FirstIn:', recordsWithFirstIn.length);
        
        res.status(200).send({
            status: 'success',
            debug: {
                today: today,
                totalRecords: attendanceRecords.length,
                recordsWithFirstIn: recordsWithFirstIn.length,
                allRecords: attendanceRecords,
                recordsWithFirstInOnly: recordsWithFirstIn
            }
        });
    } catch (err) {
        console.error('Debug endpoint error:', err);
        res.status(500).send({
            status: 'failure',
            message: 'Debug endpoint failed: ' + err.message
        });
    }
});

// GET API: Test endpoint
app.get('/attendance/test', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Attendance');
        const zcql = catalyst.zcql();
        
        console.log('=== TESTING ATTENDANCE DATA STORAGE ===');
        
        // Test 1: Check if table exists and is accessible
        console.log('Test 1: Checking table accessibility...');
        try {
            const testQuery = 'SELECT COUNT(ROWID) as total FROM Attendance';
            const countResult = await zcql.executeZCQLQuery(testQuery);
            console.log('✅ Table is accessible. Current record count:', countResult[0].Attendance.total);
        } catch (tableError) {
            console.error('❌ Table access error:', tableError.message);
            return res.status(500).send({
                status: 'failure',
                message: 'Table access failed: ' + tableError.message
            });
        }
        
        // Test 2: Try to insert a simple test record
        console.log('Test 2: Attempting to insert test record...');
        const testData = {
            EmployeeId: 'TEST001',
            AttendanceDate: '2024-01-15',
            FirstIn: '09:00:00',
            LastOut: '18:00:00',
            Status: 'Present'
        };
        
        try {
            const insertResult = await table.insertRow(testData);
            console.log('✅ Test record inserted successfully:', insertResult);
            
            // Test 3: Verify the record was actually stored
            console.log('Test 3: Verifying record was stored...');
            const verifyQuery = `
                SELECT ROWID, EmployeeId, AttendanceDate, Status FROM Attendance 
                WHERE EmployeeId = 'TEST001' 
                AND AttendanceDate = '2024-01-15'
                LIMIT 1
            `;
            const verifyResult = await zcql.executeZCQLQuery(verifyQuery);
            
            if (verifyResult.length > 0) {
                console.log('✅ Record verified in database:', verifyResult[0].Attendance);
                
                // Clean up test record
                try {
                    await table.deleteRow(insertResult.ROWID);
                    console.log('✅ Test record cleaned up successfully');
                } catch (cleanupError) {
                    console.log('⚠️ Could not clean up test record:', cleanupError.message);
                }
                
                res.status(200).send({
                    status: 'success',
                    message: 'All tests passed! Data storage is working correctly.',
                    data: {
                        testResults: {
                            tableAccess: 'PASS',
                            dataInsert: 'PASS',
                            dataVerification: 'PASS',
                            insertedRecord: insertResult,
                            verifiedRecord: verifyResult[0].Attendance
                        }
                    }
                });
            } else {
                console.log('❌ Record was not found after insertion');
                res.status(500).send({
                    status: 'failure',
                    message: 'Data verification failed - Record was inserted but not found in database',
                    data: { insertedRecord: insertResult }
                });
            }
            
        } catch (insertError) {
            console.error('❌ Insert test failed:', insertError.message);
            res.status(500).send({
                status: 'failure',
                message: 'Insert test failed: ' + insertError.message,
                data: { testData: testData }
            });
        }
        
    } catch (error) {
        console.error('Test function error:', error);
        res.status(500).send({
            status: 'failure',
            message: 'Test function failed: ' + error.message
        });
    }
});

// Helper function to convert date format from DD-MM-YYYY to YYYY-MM-DD
function convertDateFormat(dateString) {
    try {
        console.log('Converting date:', dateString);
        
        // Handle different date formats
        if (!dateString) return dateString;
        
        // If already in YYYY-MM-DD format, return as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            console.log('Date already in YYYY-MM-DD format:', dateString);
            return dateString;
        }
        
        // Handle DD-MM-YYYY format
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateString)) {
            const parts = dateString.split('-');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            const convertedDate = `${year}-${month}-${day}`;
            console.log('Converted DD-MM-YYYY to YYYY-MM-DD:', dateString, '->', convertedDate);
            return convertedDate;
        }
        
        // Handle DD/MM/YYYY format
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
            const parts = dateString.split('/');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            const convertedDate = `${year}-${month}-${day}`;
            console.log('Converted DD/MM/YYYY to YYYY-MM-DD:', dateString, '->', convertedDate);
            return convertedDate;
        }
        
        // If format is not recognized, try to parse as Date object
        const dateObj = new Date(dateString);
        if (!isNaN(dateObj.getTime())) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const convertedDate = `${year}-${month}-${day}`;
            console.log('Converted via Date object:', dateString, '->', convertedDate);
            return convertedDate;
        }
        
        console.log('Could not convert date format:', dateString);
        return dateString; // Return original if conversion fails
        
    } catch (error) {
        console.error('Error converting date:', dateString, error);
        return dateString; // Return original if conversion fails
    }
}

module.exports = app;