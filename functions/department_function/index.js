const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    const catalyst = catalystSDK.initialize(req);
    res.locals.catalyst = catalyst;
    next();
});

// GET API: Get department count
app.get('/departments/count', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Department');
        const allRows = await table.getAllRows();
        res.json({ count: allRows.length });
    } catch (err) {
        console.error('Department count error:', err);
        res.status(500).json({ error: 'Failed to get department count' });
    }
});

// GET API: Get all departments
app.get('/departments', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const rows = await zcql.executeZCQLQuery('SELECT ROWID, Department, CREATEDTIME, MODIFIEDTIME, Added_User, Modified_User FROM Department');
        const departments = rows.map(row => ({
            id: row.Department.ROWID,
            departmentName: row.Department.Department,
            addedTime: row.Department.CREATEDTIME,
            modifiedTime: row.Department.MODIFIEDTIME,
            addedUser: row.Department.Added_User,
            modifiedUser: row.Department.Modified_User
        }));
        res.status(200).send({
            status: 'success',
            data: { departments }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new department
app.post('/departments', async (req, res) => {
    try {
        const { departmentName } = req.body;
        if (!departmentName || !departmentName.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'Department is required.'
            });
        }
        const { catalyst } = res.locals;
        const userManagement = catalyst.userManagement();
        const userProfile = await userManagement.getCurrentUser();
        if (!userProfile || !userProfile.email_id) {
            return res.status(401).send({
                status: 'failure',
                message: 'Unauthorized: User email not found.'
            });
        }
        const addedUserEmail = userProfile.email_id;
        const table = catalyst.datastore().table('Department');
        const newDepartment = await table.insertRow({
            Department: departmentName.trim(),
            Added_User: addedUserEmail,
            Modified_User: addedUserEmail
        });
        res.status(200).send({
            status: 'success',
            data: {
                department: {
                    id: newDepartment.ROWID,
                    departmentName: newDepartment.Department,
                    addedUser: newDepartment.Added_User,
                    modifiedUser: newDepartment.Modified_User,
                    addedTime: newDepartment.CREATEDTIME,
                    modifiedTime: newDepartment.MODIFIEDTIME
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

// PUT API: Update a department
app.put('/departments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { departmentName } = req.body;

        if (!departmentName || !departmentName.trim()) {
            return res.status(400).send({
                status: 'failure',
                message: 'Department name is required.',
            });
        }

        const { catalyst } = res.locals;
        const userManagement = catalyst.userManagement();
        const userProfile = await userManagement.getCurrentUser();
        if (!userProfile || !userProfile.email_id) {
            return res.status(401).send({
                status: 'failure',
                message: 'Unauthorized: User email not found.',
            });
        }
        const modifiedUserEmail = userProfile.email_id;

        const table = catalyst.datastore().table('Department');
        const zcql = catalyst.zcql();

        // Fetch existing department to get Added_User
        const queryResult = await zcql.executeZCQLQuery(`SELECT Added_User FROM Department WHERE ROWID = '${id}'`);

        if (!queryResult || !queryResult.length || !queryResult[0].Department) {
            return res.status(404).send({
                status: 'failure',
                message: 'Department not found.',
            });
        }

        const existingDepartment = queryResult[0].Department;

        const updatedDepartment = await table.updateRow({
            ROWID: id,
            Department: departmentName.trim(),
            Added_User: existingDepartment.Added_User,
            Modified_User: modifiedUserEmail,
        });

        res.status(200).send({
            status: 'success',
            data: {
                department: {
                    id: updatedDepartment.ROWID,
                    departmentName: updatedDepartment.Department,
                    addedUser: updatedDepartment.Added_User,
                    modifiedUser: updatedDepartment.Modified_User,
                    addedTime: updatedDepartment.CREATEDTIME,
                    modifiedTime: updatedDepartment.MODIFIEDTIME,
                },
            },
        });
    } catch (err) {
        console.error(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || 'Invalid input provided.',
        });
    }
});

// DELETE API: Delete a department
app.delete('/departments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;

        const table = catalyst.datastore().table('Department');
        await table.deleteRow(id);

        res.status(200).send({
            status: 'success',
            message: 'Department deleted successfully.',
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request.",
        });
    }
});

module.exports = app;