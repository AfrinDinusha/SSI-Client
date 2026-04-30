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

function parseTimeToMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string') return null;
    const trimmed = timeValue.trim();
    const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return (hours * 60) + minutes;
}

function calculateTotalHours(fromTime, toTime) {
    const fromMinutes = parseTimeToMinutes(fromTime);
    const toMinutes = parseTimeToMinutes(toTime);

    if (fromMinutes === null || toMinutes === null) {
        return null;
    }

    let durationMinutes = toMinutes - fromMinutes;
    if (durationMinutes < 0) {
        durationMinutes += 24 * 60;
    }

    const totalHours = durationMinutes / 60;
    return totalHours.toFixed(2);
}

// GET API: Get all shifts
app.get('/shifts', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const rows = await zcql.executeZCQLQuery('SELECT ROWID, ShiftName, FromDate, ToDate, TotalHours, CREATEDTIME, MODIFIEDTIME FROM Shift');
        const shifts = rows.map(row => ({
            id: row.Shift.ROWID,
            shiftName: row.Shift.ShiftName,
            from: row.Shift.FromDate,
            to: row.Shift.ToDate,
            totalHours: row.Shift.TotalHours || '',
            addedTime: row.Shift.CREATEDTIME,
            modifiedTime: row.Shift.MODIFIEDTIME
        }));
        res.status(200).send({
            status: 'success',
            data: { shifts }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new shift
app.post('/shifts', async (req, res) => {
    try {
        const { shiftName, from, to } = req.body;
        if (!shiftName || !shiftName.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'Shift Name is required.'
            });
        }
        if (!from || !from.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'From time is required.'
            });
        }
        if (!to || !to.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'To time is required.'
            });
        }
        const computedTotalHours = calculateTotalHours(from.trim(), to.trim());
        if (computedTotalHours === null) {
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid time format. Please provide From and To in HH:mm format.'
            });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Shift');
        const newShift = await table.insertRow({
            ShiftName: shiftName.trim(),
            FromDate: from.trim(), // or from (if already a date string)
            ToDate: to.trim(),
            TotalHours: computedTotalHours
        });
        res.status(200).send({
            status: 'success',
            data: {
                shift: {
                    id: newShift.ROWID,
                    shiftName: newShift.ShiftName,
                    from: newShift.FromDate,
                    to: newShift.ToDate,
                    totalHours: newShift.TotalHours || computedTotalHours,
                    addedTime: newShift.CREATEDTIME,
                    modifiedTime: newShift.MODIFIEDTIME
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

// PUT API: Update a shift
app.put('/shifts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { shiftName, from, to } = req.body;
        if (!shiftName || !shiftName.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'Shift Name is required.'
            });
        }
        if (!from || !from.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'From time is required.'
            });
        }
        if (!to || !to.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'To time is required.'
            });
        }
        const computedTotalHours = calculateTotalHours(from.trim(), to.trim());
        if (computedTotalHours === null) {
            return res.status(400).send({
                status: 'failure',
                message: 'Invalid time format. Please provide From and To in HH:mm format.'
            });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Shift');
        const updatedShift = await table.updateRow({
            ROWID: id,
            ShiftName: shiftName.trim(),
            FromDate: from.trim(), // or from (if already a date string)
            ToDate: to.trim(),
            TotalHours: computedTotalHours
        });
        res.status(200).send({
            status: 'success',
            data: {
                shift: {
                    id: updatedShift.ROWID,
                    shiftName: updatedShift.ShiftName,
                    from: updatedShift.FromDate,
                    to: updatedShift.ToDate,
                    totalHours: updatedShift.TotalHours || computedTotalHours,
                    addedTime: updatedShift.CREATEDTIME,
                    modifiedTime: updatedShift.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Invalid input provided.'
        });
    }
});

// DELETE API: Delete a shift
app.delete('/shifts', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const table = catalyst.datastore().table('Shift');

        const rows = await zcql.executeZCQLQuery('SELECT ROWID FROM Shift');
        const ids = rows
            .map(row => row.Shift && row.Shift.ROWID)
            .filter(Boolean);

        if (ids.length === 0) {
            return res.status(200).send({
                status: 'success',
                message: 'No shifts found to delete.'
            });
        }

        await Promise.all(ids.map(id => table.deleteRow(id)));

        res.status(200).send({
            status: 'success',
            message: `Deleted ${ids.length} shifts successfully.`
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// DELETE API: Delete a shift
app.delete('/shifts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Shift');
        await table.deleteRow(id);
        res.status(200).send({
            status: 'success',
            message: 'Shift deleted successfully.'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

module.exports = app;
