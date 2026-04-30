const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// GET: List EHS records (paginated)
app.get('/esh', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = Math.min(parseInt(req.query.perPage) || 50, 300);
        const zcql = catalyst.zcql();
        const countResult = await zcql.executeZCQLQuery(`SELECT COUNT(ROWID) as count FROM EHS`);
        const total = countResult[0] ? parseInt(countResult[0].EHS.count) : 0;
        const result = await zcql.executeZCQLQuery(
            `SELECT ROWID, Contractor, InductionDate, Skills, AttendedCandidates, InductedCandidates, Status, CREATEDTIME, MODIFIEDTIME FROM EHS ORDER BY ROWID DESC LIMIT ${(page - 1) * perPage},${perPage}`
        );
        const esh = result.map(row => ({
            id: row.EHS.ROWID,
            contractor: row.EHS.Contractor,
            inductionDate: row.EHS.InductionDate,
            skills: row.EHS.Skills,
            attendedCandidates: row.EHS.AttendedCandidates,
            inductedCandidates: row.EHS.InductedCandidates,
            status: row.EHS.Status,
            createdTime: row.EHS.CREATEDTIME,
            modifiedTime: row.EHS.MODIFIEDTIME
        }));
        res.status(200).send({
            status: 'success',
            data: { esh, total, hasMore: page * perPage < total }
        });
    } catch (err) {
        console.error('GET /esh error:', err, err.stack);
        res.status(500).send({ status: 'failure', message: err.message || "Unable to fetch EHS records." });
    }
});

// GET: Single EHS record
app.get('/esh/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const zcql = catalyst.zcql();
        const result = await zcql.executeZCQLQuery(`SELECT * FROM EHS WHERE ROWID = ${id}`);
        if (result.length === 0) {
            return res.status(404).send({ status: 'failure', message: 'EHS record not found.' });
        }
        res.status(200).send({ status: 'success', data: { esh: result[0].EHS } });
    } catch (err) {
        console.error('GET /esh/:id error:', err);
        res.status(500).send({ status: 'failure', message: 'Failed to fetch EHS record.' });
    }
});

// POST: Add EHS record
app.post('/esh', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('EHS');
        const { Contractor, InductionDate, Skills, AttendedCandidates, InductedCandidates, Status } = req.body;
        if (!Contractor || !InductionDate) {
            return res.status(400).send({ status: 'failure', message: 'Contractor and Induction Date are required.' });
        }
        const rowData = {
            Contractor,
            InductionDate,
            Skills: Skills || null,
            AttendedCandidates: AttendedCandidates || null,
            InductedCandidates: InductedCandidates || null,
            Status: Status || null
        };
        const insertedRow = await table.insertRow(rowData);
        res.status(200).send({
            status: 'success',
            data: { esh: { id: insertedRow.ROWID, ...rowData } }
        });
    } catch (err) {
        console.error('POST /esh error:', err, err.stack);
        res.status(500).send({ status: 'failure', message: err.message || 'Failed to add EHS record.' });
    }
});

// PUT: Update EHS record
app.put('/esh/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const datastore = catalyst.datastore();
        const table = datastore.table('EHS');
        const { Contractor, InductionDate, Skills, AttendedCandidates, InductedCandidates, Status } = req.body;
        if (!Contractor || !InductionDate) {
            return res.status(400).send({ status: 'failure', message: 'Contractor and Induction Date are required.' });
        }
        const rowData = {
            ROWID: id,
            Contractor,
            InductionDate,
            Skills: Skills || null,
            AttendedCandidates: AttendedCandidates || null,
            InductedCandidates: InductedCandidates || null,
            Status: Status || null
        };
        const updatedRow = await table.updateRow(rowData);
        res.status(200).send({
            status: 'success',
            data: { esh: { id: updatedRow.ROWID, ...rowData } }
        });
    } catch (err) {
        console.error('PUT /esh/:id error:', err);
        res.status(500).send({ status: 'failure', message: err.message || 'Failed to update EHS record.' });
    }
});

// DELETE: Remove EHS record
app.delete('/esh/:id', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { id } = req.params;
        const table = catalyst.datastore().table('EHS');
        await table.deleteRow(id);
        res.status(200).send({ status: 'success', data: { esh: { id } } });
    } catch (err) {
        console.error('DELETE /esh/:id error:', err);
        res.status(500).send({ status: 'failure', message: "Unable to delete EHS record." });
    }
});

module.exports = app;