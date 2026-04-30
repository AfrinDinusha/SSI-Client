const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// GET API: Get all designations
app.get('/designations', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const rows = await zcql.executeZCQLQuery('SELECT ROWID, Designation, SkillType FROM Designation');
        const designations = rows.map(row => ({
            id: row.Designation.ROWID,
            designationName: row.Designation.Designation,
            skillType: row.Designation.SkillType || ''
        }));
        res.status(200).send({
            status: 'success',
            data: { designations }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new designation
app.post('/designations', async (req, res) => {
    try {
        const { designationName, skillType } = req.body;
        if (!designationName || !designationName.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'Designation is required.'
            });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Designation');
        const { ROWID: id } = await table.insertRow({
            Designation: designationName.trim(),
            SkillType: skillType ? skillType.trim() : ''
        });
        res.status(200).send({
            status: 'success',
            data: {
                designation: {
                    id,
                    designationName: designationName.trim(),
                    skillType: skillType ? skillType.trim() : ''
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

// PUT API: Update a designation
app.put('/designations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { designationName, skillType } = req.body;
        if (!designationName || !designationName.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'Designation is required.'
            });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Designation');
        await table.updateRow({
            ROWID: id,
            Designation: designationName.trim(),
            SkillType: skillType ? skillType.trim() : ''
        });
        res.status(200).send({
            status: 'success',
            message: 'Designation updated successfully!'
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Failed to update designation.'
        });
    }
});

app.delete('/designations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Designation');
    await table.deleteRow(id);
    res.status(200).send({
      status: 'success',
      message: 'Designation deleted successfully!'
    });
  } catch (err) {
    console.log(err);
    res.status(400).send({
      status: 'failure',
      message: err.message || 'Failed to delete designation.'
    });
  }
});

module.exports = app;
