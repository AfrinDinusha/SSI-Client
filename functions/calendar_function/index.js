const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// GET API: Get all holidays from Calendar table
app.get('/calendar', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        // Query to fetch all holidays from Calendar table
        const queryString = `SELECT ROWID, Festival, CalendarDate, CREATEDTIME, MODIFIEDTIME, CREATORID FROM Calendar ORDER BY CalendarDate ASC`;
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
        const holidays = queryResult.map(row => {
            const calendar = row.Calendar;
            // Format CalendarDate to YYYY-MM-DD if needed
            let dateStr = calendar.CalendarDate || '';
            if (dateStr && dateStr.includes('T')) {
                dateStr = dateStr.split('T')[0];
            } else if (dateStr && dateStr.length > 10) {
                dateStr = dateStr.substring(0, 10);
            }
            
            return {
                id: String(calendar.ROWID || ''),
                festival: calendar.Festival || '',
                date: dateStr,
                createdTime: calendar.CREATEDTIME || null,
                modifiedTime: calendar.MODIFIEDTIME || null,
                creatorId: calendar.CREATORID || '',
            };
        });

        res.status(200).json({
            status: 'success',
            data: {
                holidays: holidays
            }
        });
    } catch (err) {
        console.error('Get holidays error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to fetch holidays: ' + err.message
        });
    }
});

// POST API: Create a new holiday in Calendar table
app.post('/calendar', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const datastore = catalyst.datastore();
        const table = datastore.table('Calendar');

        const { festival, date } = req.body;

        // Validate required fields
        if (!festival || !date) {
            return res.status(400).json({
                status: 'failure',
                message: 'Festival and Date are required'
            });
        }

        // Normalize date to YYYY-MM-DD format
        let normalizedDate = date;
        if (normalizedDate.includes('T')) {
            normalizedDate = normalizedDate.split('T')[0];
        } else if (normalizedDate.length > 10) {
            normalizedDate = normalizedDate.substring(0, 10);
        }

        // Check if holiday already exists for this date
        const zcql = catalyst.zcql();
        const checkQuery = `SELECT ROWID FROM Calendar WHERE CalendarDate = '${normalizedDate}' LIMIT 1`;
        try {
            const existingRecords = await zcql.executeZCQLQuery(checkQuery);
            if (existingRecords && existingRecords.length > 0) {
                return res.status(400).json({
                    status: 'failure',
                    message: 'A holiday already exists for this date'
                });
            }
        } catch (checkError) {
            console.error('Error checking existing holiday:', checkError);
            // Continue with insert even if check fails
        }

        // Prepare row data
        const rowData = {
            Festival: festival.trim(),
            CalendarDate: normalizedDate,
        };

        console.log('Inserting holiday record:', rowData);

        // Insert the row
        const insertPromise = table.insertRow(rowData);
        const insertedRow = await insertPromise;

        console.log('Holiday record inserted successfully:', insertedRow);

        // Fetch the inserted record to return complete data
        const queryString = `SELECT ROWID, Festival, CalendarDate, CREATEDTIME, MODIFIEDTIME, CREATORID FROM Calendar WHERE ROWID = ${insertedRow.ROWID}`;
        const queryResult = await zcql.executeZCQLQuery(queryString);

        if (!queryResult || queryResult.length === 0) {
            throw new Error('Failed to fetch inserted record');
        }

        const calendar = queryResult[0].Calendar;
        let dateStr = calendar.CalendarDate || '';
        if (dateStr && dateStr.includes('T')) {
            dateStr = dateStr.split('T')[0];
        } else if (dateStr && dateStr.length > 10) {
            dateStr = dateStr.substring(0, 10);
        }

        const result = {
            id: String(calendar.ROWID || insertedRow.ROWID),
            festival: calendar.Festival || '',
            date: dateStr,
            createdTime: calendar.CREATEDTIME || null,
            modifiedTime: calendar.MODIFIEDTIME || null,
            creatorId: calendar.CREATORID || '',
        };

        res.status(201).json({
            status: 'success',
            message: 'Holiday created successfully',
            data: {
                holiday: result
            }
        });
    } catch (err) {
        console.error('Create holiday error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to create holiday: ' + err.message
        });
    }
});

// DELETE API: Delete a holiday from Calendar table
app.delete('/calendar/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const id = req.params.id;
        const datastore = catalyst.datastore();
        const table = datastore.table('Calendar');

        console.log('Deleting holiday record:', id);

        // Delete the holiday row
        await table.deleteRow(id);

        console.log('Holiday record deleted successfully');

        res.status(200).json({
            status: 'success',
            message: 'Holiday deleted successfully'
        });
    } catch (err) {
        console.error('Delete holiday error:', err);
        res.status(500).json({
            status: 'failure',
            message: 'Failed to delete holiday: ' + err.message
        });
    }
});

module.exports = app;
