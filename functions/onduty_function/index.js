const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// GET API: Get all on duty records (with optional pagination)
app.get('/onduty', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
       
        console.log('OnDuty fetch request:', { userEmail, userRole, page, perPage });
        const zcql = catalyst.zcql();

        // Get total count for pagination
        const countQuery = `SELECT COUNT(ROWID) as count FROM OnDuty`;
        console.log(`Executing count query: ${countQuery}`);
        
        let countRows;
        let total = 0;
        try {
            countRows = await zcql.executeZCQLQuery(countQuery);
            console.log(`Count query result:`, countRows);
            total = parseInt(countRows[0].OnDuty['COUNT(ROWID)']) || 0;
            console.log(`Total on duty records found: ${total}`);
        } catch (countError) {
            console.error('Count query error:', countError);
            total = 0;
        }

        // Check if we should return all records (no pagination)
        const returnAll = !req.query.page && !req.query.perPage;
       
        // Build LIMIT clause
        const limitClause = returnAll ? '' : `LIMIT ${(page - 1) * perPage + 1},${perPage}`;

        // Query to fetch on duty records
        const queryColumns = [
            'ROWID', 'EmployeeCode', 'EmployeeName', 'NoofHours', 'Reason', 'OnDutyDate', 'FirstIn', 'Lastout',
            'CREATEDTIME', 'MODIFIEDTIME', 'CREATORID'
        ];
        
        const queryString = `SELECT ${queryColumns.join(', ')} FROM OnDuty ORDER BY ROWID DESC ${limitClause}`;
        console.log(`Executing query: ${queryString}`);
        
        let queryResult;
        try {
            queryResult = await zcql.executeZCQLQuery(queryString);
            console.log(`Query result count: ${queryResult.length}`);
        } catch (queryError) {
            console.error('Query error:', queryError);
            queryResult = [];
        }

        // Transform the results
        const onduties = queryResult.map(row => {
            const onduty = row.OnDuty;
            return {
                id: String(onduty.ROWID || ''),
                employeeCode: onduty.EmployeeCode || '',
                employeeName: onduty.EmployeeName || '',
                noofHours: onduty.NoofHours || '',
                reason: onduty.Reason || '',
                onDutyDate: onduty.OnDutyDate || '',
                firstIn: onduty.FirstIn || '',
                lastOut: onduty.Lastout || '',
                addedTime: onduty.CREATEDTIME || null,
                modifiedTime: onduty.MODIFIEDTIME || null,
                addedUser: onduty.CREATORID || '',
                modifiedUser: onduty.CREATORID || '',
            };
        });

        // Check if there are more records
        const hasMore = returnAll ? false : (page * perPage < total);

        res.status(200).json({
            status: 'success',
            data: {
                onduties: onduties,
                total: total,
                page: page,
                perPage: perPage,
                hasMore: hasMore
            }
        });
    } catch (err) {
        console.error('Get on duty records error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fetch on duty records: ' + err.message
        });
    }
});

// GET API: Get a single on duty record by ID
app.get('/onduty/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const zcql = catalyst.zcql();

        const queryString = `SELECT ROWID, EmployeeCode, EmployeeName, NoofHours, Reason, OnDutyDate, FirstIn, Lastout, CREATEDTIME, MODIFIEDTIME, CREATORID FROM OnDuty WHERE ROWID = ${id}`;
        console.log(`Executing query: ${queryString}`);
        
        const queryResult = await zcql.executeZCQLQuery(queryString);
        
        if (!queryResult || queryResult.length === 0) {
            return res.status(404).json({
                status: 'failure',
                message: 'On duty record not found'
            });
        }

        const onduty = queryResult[0].OnDuty;
        const result = {
            id: String(onduty.ROWID || id),
            employeeCode: onduty.EmployeeCode || '',
            employeeName: onduty.EmployeeName || '',
            noofHours: onduty.NoofHours || '',
            reason: onduty.Reason || '',
            onDutyDate: onduty.OnDutyDate || '',
            firstIn: onduty.FirstIn || '',
            lastOut: onduty.Lastout || '',
            addedTime: onduty.CREATEDTIME || null,
            modifiedTime: onduty.MODIFIEDTIME || null,
            addedUser: onduty.CREATORID || '',
            modifiedUser: onduty.CREATORID || '',
        };

        res.status(200).json({
            status: 'success',
            data: {
                onduty: result
            }
        });
    } catch (err) {
        console.error('Get on duty record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fetch on duty record: ' + err.message
        });
    }
});

// POST API: Create a new on duty record
app.post('/onduty', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        const table = datastore.table('OnDuty');

        const { employeeCode, employeeName, noofHours, reason, onDutyDate, firstIn, lastOut } = req.body;

        // Validate required fields - only Employee Code is required, Employee Name is optional
        if (!employeeCode) {
            return res.status(400).json({
                status: 'failure',
                message: 'Employee Code is required'
            });
        }

        // Helper function to normalize date to YYYY-MM-DD format
        const normalizeDate = (dateStr) => {
            if (!dateStr) return '';
            const str = String(dateStr).trim();
            // If already in YYYY-MM-DD format, return it
            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
            // If in DD-MM-YYYY format, convert to YYYY-MM-DD
            const dmy = str.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
            if (dmy) {
                const [, day, month, year] = dmy;
                return `${year}-${month}-${day}`;
            }
            // Try to parse as a date
            try {
                const date = new Date(str);
                if (!isNaN(date.getTime())) {
                    // Use UTC methods to avoid timezone shifts when parsing dates
                    // If the string is YYYY-MM-DD format, parse it directly to avoid timezone conversion
                    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
                        const [year, month, day] = str.split('-');
                        return `${year}-${month}-${day}`;
                    }
                    // Otherwise use UTC methods to extract date components
                    const year = date.getUTCFullYear();
                    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(date.getUTCDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                }
            } catch (e) {
                // If parsing fails, return as is
            }
            return str;
        };

        // Helper function to normalize time and combine with date
        const normalizeTimeWithDate = (timeStr, dateStr) => {
            if (!timeStr) return '';
            const time = String(timeStr).trim();
            if (!time) return '';
            
            // If already a full datetime (YYYY-MM-DD HH:mm:ss), return as is
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(time)) return time;
            
            // Normalize the date first
            const normalizedDate = normalizeDate(dateStr);
            if (!normalizedDate) return time; // If no date, return time as is
            
            // If time is in HH:mm format, combine with date
            const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (timeMatch) {
                const hours = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
                const minutes = timeMatch[2];
                const seconds = timeMatch[3] || '00';
                return `${normalizedDate} ${hours}:${minutes}:${seconds}`;
            }
            
            // If time includes AM/PM
            const ampmMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
            if (ampmMatch) {
                let hours = parseInt(ampmMatch[1], 10);
                const minutes = ampmMatch[2];
                const seconds = ampmMatch[3] || '00';
                const ampm = ampmMatch[4] ? ampmMatch[4].toUpperCase() : null;
                
                if (ampm === 'PM' && hours < 12) hours += 12;
                if (ampm === 'AM' && hours === 12) hours = 0;
                
                const hoursStr = String(hours).padStart(2, '0');
                return `${normalizedDate} ${hoursStr}:${minutes}:${seconds}`;
            }
            
            // If we can't parse it, try to combine as is
            return `${normalizedDate} ${time}`;
        };

        // Normalize the date
        const normalizedDate = normalizeDate(onDutyDate);
        
        // Normalize FirstIn and LastOut by combining with date
        const normalizedFirstIn = normalizeTimeWithDate(firstIn, normalizedDate);
        const normalizedLastOut = normalizeTimeWithDate(lastOut, normalizedDate);

        // Prepare row data with normalized date and times
        const rowData = {
            EmployeeCode: employeeCode || '',
            EmployeeName: employeeName || '',
            NoofHours: noofHours || '',
            Reason: reason || '',
            OnDutyDate: normalizedDate,
            FirstIn: normalizedFirstIn,
            Lastout: normalizedLastOut,
        };

        console.log('Inserting on duty record:', rowData);

        // Insert the row
        const insertPromise = table.insertRow(rowData);
        const insertedRow = await insertPromise;

        console.log('On duty record inserted successfully:', insertedRow);

        // Fetch the inserted record to return complete data
        const zcql = catalyst.zcql();
        const queryString = `SELECT ROWID, EmployeeCode, EmployeeName, NoofHours, Reason, OnDutyDate, FirstIn, Lastout, CREATEDTIME, MODIFIEDTIME, CREATORID FROM OnDuty WHERE ROWID = ${insertedRow.ROWID}`;
        const queryResult = await zcql.executeZCQLQuery(queryString);

        if (!queryResult || queryResult.length === 0) {
            throw new Error('Failed to fetch inserted record');
        }

        const onduty = queryResult[0].OnDuty;
        const result = {
            id: String(onduty.ROWID || insertedRow.ROWID),
            employeeCode: onduty.EmployeeCode || '',
            employeeName: onduty.EmployeeName || '',
            noofHours: onduty.NoofHours || '',
            reason: onduty.Reason || '',
            onDutyDate: onduty.OnDutyDate || '',
            firstIn: onduty.FirstIn || '',
            lastOut: onduty.Lastout || '',
            addedTime: onduty.CREATEDTIME || null,
            modifiedTime: onduty.MODIFIEDTIME || null,
            addedUser: onduty.CREATORID || '',
            modifiedUser: onduty.CREATORID || '',
        };

        res.status(201).json({
            status: 'success',
            message: 'On duty record created successfully',
            data: {
                onduty: result
            }
        });
    } catch (err) {
        console.error('Create on duty record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to create on duty record: ' + err.message
        });
    }
});

// PUT API: Update an existing on duty record
app.put('/onduty/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const datastore = catalyst.datastore();
        const table = datastore.table('OnDuty');

        const { employeeCode, employeeName, noofHours, reason, onDutyDate, firstIn, lastOut } = req.body;

        // Validate required fields - only Employee Code is required, Employee Name is optional
        if (!employeeCode) {
            return res.status(400).json({
                status: 'failure',
                message: 'Employee Code is required'
            });
        }

        // Helper function to normalize date to YYYY-MM-DD format
        const normalizeDate = (dateStr) => {
            if (!dateStr) return '';
            const str = String(dateStr).trim();
            // If already in YYYY-MM-DD format, return it
            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
            // If in DD-MM-YYYY format, convert to YYYY-MM-DD
            const dmy = str.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
            if (dmy) {
                const [, day, month, year] = dmy;
                return `${year}-${month}-${day}`;
            }
            // Try to parse as a date
            try {
                const date = new Date(str);
                if (!isNaN(date.getTime())) {
                    // Use UTC methods to avoid timezone shifts when parsing dates
                    // If the string is YYYY-MM-DD format, parse it directly to avoid timezone conversion
                    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
                        const [year, month, day] = str.split('-');
                        return `${year}-${month}-${day}`;
                    }
                    // Otherwise use UTC methods to extract date components
                    const year = date.getUTCFullYear();
                    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(date.getUTCDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                }
            } catch (e) {
                // If parsing fails, return as is
            }
            return str;
        };

        // Helper function to normalize time and combine with date
        const normalizeTimeWithDate = (timeStr, dateStr) => {
            if (!timeStr) return '';
            const time = String(timeStr).trim();
            if (!time) return '';
            
            // If already a full datetime (YYYY-MM-DD HH:mm:ss), return as is
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(time)) return time;
            
            // Normalize the date first
            const normalizedDate = normalizeDate(dateStr);
            if (!normalizedDate) return time; // If no date, return time as is
            
            // If time is in HH:mm format, combine with date
            const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (timeMatch) {
                const hours = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
                const minutes = timeMatch[2];
                const seconds = timeMatch[3] || '00';
                return `${normalizedDate} ${hours}:${minutes}:${seconds}`;
            }
            
            // If time includes AM/PM
            const ampmMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
            if (ampmMatch) {
                let hours = parseInt(ampmMatch[1], 10);
                const minutes = ampmMatch[2];
                const seconds = ampmMatch[3] || '00';
                const ampm = ampmMatch[4] ? ampmMatch[4].toUpperCase() : null;
                
                if (ampm === 'PM' && hours < 12) hours += 12;
                if (ampm === 'AM' && hours === 12) hours = 0;
                
                const hoursStr = String(hours).padStart(2, '0');
                return `${normalizedDate} ${hoursStr}:${minutes}:${seconds}`;
            }
            
            // If we can't parse it, try to combine as is
            return `${normalizedDate} ${time}`;
        };

        // Normalize the date
        const normalizedDate = normalizeDate(onDutyDate);
        
        // Normalize FirstIn and LastOut by combining with date
        const normalizedFirstIn = normalizeTimeWithDate(firstIn, normalizedDate);
        const normalizedLastOut = normalizeTimeWithDate(lastOut, normalizedDate);

        // Prepare row data for update - use ID directly as string (like EmployeeManagement)
        const rowData = {
            ROWID: id,
            EmployeeCode: employeeCode || '',
            EmployeeName: employeeName || '',
            NoofHours: noofHours || '',
            Reason: reason || '',
            OnDutyDate: normalizedDate,
            FirstIn: normalizedFirstIn,
            Lastout: normalizedLastOut,
        };

        console.log('Updating on duty record:', rowData);

        // Update the row
        await table.updateRow(rowData);

        console.log('On duty record updated successfully');

        // Fetch the updated record to return complete data (like EmployeeManagement)
        const ondutyRow = await table.getRow(id);
        
        // Convert ROWID to string to avoid BigInt serialization issues
        const result = {
            id: String(ondutyRow.ROWID || id),
            employeeCode: ondutyRow.EmployeeCode || '',
            employeeName: ondutyRow.EmployeeName || '',
            noofHours: ondutyRow.NoofHours || '',
            reason: ondutyRow.Reason || '',
            onDutyDate: ondutyRow.OnDutyDate || '',
            firstIn: ondutyRow.FirstIn || '',
            lastOut: ondutyRow.Lastout || '',
            addedTime: ondutyRow.CREATEDTIME || null,
            modifiedTime: ondutyRow.MODIFIEDTIME || null,
            addedUser: ondutyRow.CREATORID || '',
            modifiedUser: ondutyRow.CREATORID || '',
        };

        res.status(200).json({
            status: 'success',
            message: 'On duty record updated successfully',
            data: {
                onduty: result
            }
        });
    } catch (err) {
        console.error('Update on duty record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to update on duty record: ' + err.message
        });
    }
});

// DELETE API: Delete an on duty record
app.delete('/onduty/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const datastore = catalyst.datastore();
        const table = datastore.table('OnDuty');

        console.log('Deleting on duty record:', id);

        // Delete the row - use ID directly as string (like EmployeeManagement)
        await table.deleteRow(id);

        console.log('On duty record deleted successfully');

        res.status(200).json({
            status: 'success',
            message: 'On duty record deleted successfully'
        });
    } catch (err) {
        console.error('Delete on duty record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to delete on duty record: ' + err.message
        });
    }
});

module.exports = app;
