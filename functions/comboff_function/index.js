const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// Helper function to add attendance record for comp off taken date
async function addAttendanceForCompOff(catalyst, employeeCode, takenDate) {
    try {
        if (!takenDate || !employeeCode) {
            console.log('Skipping attendance creation: missing takenDate or employeeCode');
            return;
        }

        // Format date to YYYY-MM-DD if needed
        let formattedDate = takenDate;
        if (takenDate.includes('T')) {
            formattedDate = takenDate.split('T')[0];
        } else if (takenDate.length > 10) {
            formattedDate = takenDate.substring(0, 10);
        }

        const datastore = catalyst.datastore();
        const attendanceTable = datastore.table('Attendance');
        const zcql = catalyst.zcql();

        // Check if attendance record already exists
        const checkQuery = `SELECT ROWID FROM Attendance WHERE EmployeeId = '${employeeCode}' AND AttendanceDate = '${formattedDate}' LIMIT 1`;
        const existingRecord = await zcql.executeZCQLQuery(checkQuery);

        if (existingRecord && existingRecord.length > 0) {
            console.log(`Attendance record already exists for employee ${employeeCode} on ${formattedDate}`);
            // Update existing record to Present if not already
            const existingRow = await attendanceTable.getRow(existingRecord[0].Attendance.ROWID);
            if (existingRow.Status !== 'Present') {
                const updateData = {
                    ROWID: existingRecord[0].Attendance.ROWID,
                    EmployeeId: employeeCode,
                    AttendanceDate: formattedDate,
                    Status: 'Present'
                };
                // Preserve existing FirstIn and LastOut if they exist
                if (existingRow.FirstIn) updateData.FirstIn = existingRow.FirstIn;
                if (existingRow.LastOut) updateData.LastOut = existingRow.LastOut;
                await attendanceTable.updateRow(updateData);
                console.log(`Updated attendance record to Present for employee ${employeeCode} on ${formattedDate}`);
            }
            return;
        }

        // Create new attendance record
        const attendanceData = {
            EmployeeId: employeeCode.trim(),
            AttendanceDate: formattedDate.trim(),
            Status: 'Present',
            FirstIn: '08:25:00', // Default time for comp off
            LastOut: '16:55:00'  // Default time for comp off
        };

        await attendanceTable.insertRow(attendanceData);
        console.log(`Created attendance record (Present) for employee ${employeeCode} on ${formattedDate} from comp off`);
    } catch (err) {
        // Log error but don't fail the comp off creation/update
        console.error('Error adding attendance record for comp off:', err);
        console.error('Employee Code:', employeeCode, 'Taken Date:', takenDate);
    }
}

// GET API: Get all comp off records (with optional pagination)
app.get('/comboff', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 50;
        const userEmail = req.query.userEmail;
        const userRole = req.query.userRole;
       
        console.log('CompOff fetch request:', { userEmail, userRole, page, perPage });
        const zcql = catalyst.zcql();

        // Get total count for pagination
        const countQuery = `SELECT COUNT(ROWID) as count FROM Comboff`;
        console.log(`Executing count query: ${countQuery}`);
        
        let countRows;
        let total = 0;
        try {
            countRows = await zcql.executeZCQLQuery(countQuery);
            console.log(`Count query result:`, countRows);
            total = parseInt(countRows[0].Comboff['COUNT(ROWID)']) || 0;
            console.log(`Total comp off records found: ${total}`);
        } catch (countError) {
            console.error('Count query error:', countError);
            total = 0;
        }

        // Check if we should return all records (no pagination)
        const returnAll = !req.query.page && !req.query.perPage;
       
        // Build LIMIT clause
        const limitClause = returnAll ? '' : `LIMIT ${(page - 1) * perPage + 1},${perPage}`;

        // Query to fetch comp off records
        const queryColumns = [
            'ROWID', 'EmployeeCode', 'EmployeeName', 'WorkedOn', 'Taken',
            'ComboffStatus', 'OT',
            'CREATEDTIME', 'MODIFIEDTIME', 'CREATORID'
        ];
        
        const queryString = `SELECT ${queryColumns.join(', ')} FROM Comboff ORDER BY ROWID DESC ${limitClause}`;
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
        const compoffs = queryResult.map(row => {
            const compoff = row.Comboff;
            return {
                id: String(compoff.ROWID || ''),
                employeeCode: compoff.EmployeeCode || '',
                employeeName: compoff.EmployeeName || '',
                workedOn: compoff.WorkedOn || '',
                taken: compoff.Taken || '',
                compoffStatus: compoff.ComboffStatus || '',
                otStatus: compoff.OT || '',
                addedTime: compoff.CREATEDTIME || null,
                modifiedTime: compoff.MODIFIEDTIME || null,
                addedUser: compoff.CREATORID || '',
                modifiedUser: compoff.CREATORID || '',
            };
        });

        // Check if there are more records
        const hasMore = returnAll ? false : (page * perPage < total);

        res.status(200).json({
            status: 'success',
            data: {
                compoffs: compoffs,
                total: total,
                page: page,
                perPage: perPage,
                hasMore: hasMore
            }
        });
    } catch (err) {
        console.error('Get comp off records error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fetch comp off records: ' + err.message
        });
    }
});

// GET API: Get a single comp off record by ID
app.get('/comboff/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const zcql = catalyst.zcql();

        const queryString = `SELECT ROWID, EmployeeCode, EmployeeName, WorkedOn, Taken, ComboffStatus, OT, CREATEDTIME, MODIFIEDTIME, CREATORID FROM Comboff WHERE ROWID = ${id}`;
        console.log(`Executing query: ${queryString}`);
        
        const queryResult = await zcql.executeZCQLQuery(queryString);
        
        if (!queryResult || queryResult.length === 0) {
            return res.status(404).json({
                status: 'failure',
                message: 'Comp off record not found'
            });
        }

        const compoff = queryResult[0].Comboff;
        const result = {
            id: String(compoff.ROWID || id),
            employeeCode: compoff.EmployeeCode || '',
            employeeName: compoff.EmployeeName || '',
            workedOn: compoff.WorkedOn || '',
            taken: compoff.Taken || '',
            compoffStatus: compoff.ComboffStatus || '',
            otStatus: compoff.OT || '',
            addedTime: compoff.CREATEDTIME || null,
            modifiedTime: compoff.MODIFIEDTIME || null,
            addedUser: compoff.CREATORID || '',
            modifiedUser: compoff.CREATORID || '',
        };

        res.status(200).json({
            status: 'success',
            data: {
                compoff: result
            }
        });
    } catch (err) {
        console.error('Get comp off record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fetch comp off record: ' + err.message
        });
    }
});

// POST API: Create a new comp off record
app.post('/comboff', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        const table = datastore.table('Comboff');

        const { employeeCode, employeeName, workedOn, taken, compoffStatus, otStatus } = req.body;

        // Validate required fields - only Employee Code is required, Employee Name is optional
        if (!employeeCode) {
            return res.status(400).json({
                status: 'failure',
                message: 'Employee Code is required'
            });
        }

        // Prepare row data
        const rowData = {
            EmployeeCode: employeeCode || '',
            EmployeeName: employeeName || '',
            WorkedOn: workedOn || '',
            Taken: taken || '',
            ComboffStatus: compoffStatus || '',
            OT: otStatus || '',
        };

        console.log('Inserting comp off record:', rowData);

        // Insert the row
        const insertPromise = table.insertRow(rowData);
        const insertedRow = await insertPromise;

        console.log('Comp off record inserted successfully:', insertedRow);

        // Fetch the inserted record to return complete data
        const zcql = catalyst.zcql();
        const queryString = `SELECT ROWID, EmployeeCode, EmployeeName, WorkedOn, Taken, ComboffStatus, OT, CREATEDTIME, MODIFIEDTIME, CREATORID FROM Comboff WHERE ROWID = ${insertedRow.ROWID}`;
        const queryResult = await zcql.executeZCQLQuery(queryString);

        if (!queryResult || queryResult.length === 0) {
            throw new Error('Failed to fetch inserted record');
        }

        const compoff = queryResult[0].Comboff;
        const result = {
            id: String(compoff.ROWID || insertedRow.ROWID),
            employeeCode: compoff.EmployeeCode || '',
            employeeName: compoff.EmployeeName || '',
            workedOn: compoff.WorkedOn || '',
            taken: compoff.Taken || '',
            compoffStatus: compoff.ComboffStatus || '',
            otStatus: compoff.OT || '',
            addedTime: compoff.CREATEDTIME || null,
            modifiedTime: compoff.MODIFIEDTIME || null,
            addedUser: compoff.CREATORID || '',
            modifiedUser: compoff.CREATORID || '',
        };

        // Add attendance record for taken date only when Comboff Status = Yes (so muster shows CO on that date)
        if (compoff.Taken && compoff.EmployeeCode && (String(compoff.ComboffStatus || '').trim().toLowerCase() === 'yes')) {
            await addAttendanceForCompOff(catalyst, compoff.EmployeeCode, compoff.Taken);
        }

        res.status(201).json({
            status: 'success',
            message: 'Comp off record created successfully',
            data: {
                compoff: result
            }
        });
    } catch (err) {
        console.error('Create comp off record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to create comp off record: ' + err.message
        });
    }
});

// PUT API: Update an existing comp off record
app.put('/comboff/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const datastore = catalyst.datastore();
        const table = datastore.table('Comboff');

        const { employeeCode, employeeName, workedOn, taken, compoffStatus, otStatus } = req.body;

        // Validate required fields - only Employee Code is required, Employee Name is optional
        if (!employeeCode) {
            return res.status(400).json({
                status: 'failure',
                message: 'Employee Code is required'
            });
        }

        // Prepare row data for update
        const rowData = {
            ROWID: id,
            EmployeeCode: employeeCode || '',
            EmployeeName: employeeName || '',
            WorkedOn: workedOn || '',
            Taken: taken || '',
            ComboffStatus: compoffStatus || '',
            OT: otStatus || '',
        };

        console.log('Updating comp off record:', rowData);

        // Update the row
        await table.updateRow(rowData);

        console.log('Comp off record updated successfully');

        // Fetch the updated record to return complete data
        const compoffRow = await table.getRow(id);
        
        // Convert ROWID to string to avoid BigInt serialization issues
        const result = {
            id: String(compoffRow.ROWID || id),
            employeeCode: compoffRow.EmployeeCode || '',
            employeeName: compoffRow.EmployeeName || '',
            workedOn: compoffRow.WorkedOn || '',
            taken: compoffRow.Taken || '',
            compoffStatus: compoffRow.ComboffStatus || '',
            otStatus: compoffRow.OT || '',
            addedTime: compoffRow.CREATEDTIME || null,
            modifiedTime: compoffRow.MODIFIEDTIME || null,
            addedUser: compoffRow.CREATORID || '',
            modifiedUser: compoffRow.CREATORID || '',
        };

        // Add attendance record for taken date only when Comboff Status = Yes
        if (compoffRow.Taken && compoffRow.EmployeeCode && (String(compoffRow.ComboffStatus || '').trim().toLowerCase() === 'yes')) {
            await addAttendanceForCompOff(catalyst, compoffRow.EmployeeCode, compoffRow.Taken);
        }

        res.status(200).json({
            status: 'success',
            message: 'Comp off record updated successfully',
            data: {
                compoff: result
            }
        });
    } catch (err) {
        console.error('Update comp off record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to update comp off record: ' + err.message
        });
    }
});

// DELETE API: Delete a comp off record
app.delete('/comboff/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const datastore = catalyst.datastore();
        const table = datastore.table('Comboff');

        console.log('Deleting comp off record:', id);

        // First, fetch the comp off record to get Taken date and EmployeeCode
        let compoffRow;
        try {
            compoffRow = await table.getRow(id);
        } catch (fetchError) {
            console.error('Error fetching comp off record before delete:', fetchError);
            // Continue with delete even if fetch fails
        }

        // Delete the comp off row
        await table.deleteRow(id);

        console.log('Comp off record deleted successfully');

        // If we have the comp off data and it has a Taken date, delete the corresponding attendance record
        if (compoffRow && compoffRow.Taken && compoffRow.EmployeeCode) {
            try {
                // Format date to YYYY-MM-DD if needed
                let formattedDate = compoffRow.Taken;
                if (compoffRow.Taken.includes('T')) {
                    formattedDate = compoffRow.Taken.split('T')[0];
                } else if (compoffRow.Taken.length > 10) {
                    formattedDate = compoffRow.Taken.substring(0, 10);
                }

                const attendanceTable = datastore.table('Attendance');
                const zcql = catalyst.zcql();

                // Find the attendance record for this employee and date
                const findQuery = `SELECT ROWID FROM Attendance WHERE EmployeeId = '${compoffRow.EmployeeCode}' AND AttendanceDate = '${formattedDate}' LIMIT 1`;
                const attendanceRecords = await zcql.executeZCQLQuery(findQuery);

                if (attendanceRecords && attendanceRecords.length > 0) {
                    const attendanceRowId = attendanceRecords[0].Attendance.ROWID;
                    
                    // Check if this attendance record was created from comp off (has default times 08:25:00 and 16:55:00)
                    const attendanceRow = await attendanceTable.getRow(attendanceRowId);
                    const firstIn = attendanceRow.FirstIn || '';
                    const lastOut = attendanceRow.LastOut || '';
                    
                    // Only delete if it matches comp off default times (to avoid deleting manually created attendance)
                    if ((firstIn.includes('08:25') || firstIn === '08:25:00') && 
                        (lastOut.includes('16:55') || lastOut === '16:55:00')) {
                        await attendanceTable.deleteRow(attendanceRowId);
                        console.log(`Deleted corresponding attendance record (ID: ${attendanceRowId}) for employee ${compoffRow.EmployeeCode} on ${formattedDate}`);
                    } else {
                        console.log(`Attendance record exists but has different times, not deleting. FirstIn: ${firstIn}, LastOut: ${lastOut}`);
                    }
                } else {
                    console.log(`No attendance record found for employee ${compoffRow.EmployeeCode} on ${formattedDate}`);
                }
            } catch (attendanceDeleteError) {
                // Log error but don't fail the comp off deletion
                console.error('Error deleting corresponding attendance record:', attendanceDeleteError);
                console.error('Employee Code:', compoffRow.EmployeeCode, 'Taken Date:', compoffRow.Taken);
            }
        }

        res.status(200).json({
            status: 'success',
            message: 'Comp off record deleted successfully'
        });
    } catch (err) {
        console.error('Delete comp off record error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to delete comp off record: ' + err.message
        });
    }
});

module.exports = app;
