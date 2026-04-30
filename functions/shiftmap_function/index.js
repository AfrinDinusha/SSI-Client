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

// Get all shift mappings
app.get('/shiftmaps', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const userRole = req.query.userRole || '';
        const userEmail = req.query.userEmail || '';
        
        let employeeIds = [];
        
        // If user is App User (contractor), filter by contractor email
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;
           
            // Check hardcoded mappings (same logic as cms_function)
            if (userEmail === "afrindinusha29@gmail.com" || userEmail === "sriramenterprises50@yahoo.com") {
                contractorName = "Sriram Enterprises";
            } else if (userEmail === "afrindinusha@gmail.com" || userEmail === "rpdmanpowerservice@gmail.com" || userEmail === "ramachandran23488@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
            } else if (userEmail === "afrinatlin@gmail.com" || userEmail === "samuelenterprisesms@gmail.com") {
                // Try to find the actual contractor name in the database
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
                // For NAPS, try to find the actual contractor name in the database
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
                // For other App Users, try to find contractor by email
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
           
            // Get employee IDs for this contractor
            if (contractorName) {
                const escapedContractorName = contractorName.replace(/'/g, "''");
                
                let employeeQuery;
                // For Samuel Enterprise/Enterprises, use flexible matching
                if (contractorName.toLowerCase().includes('samuel')) {
                    employeeQuery = `SELECT ROWID FROM Employee WHERE ContractorName LIKE '%Samuel%'`;
                } else if (contractorName.toUpperCase().includes('NAPS')) {
                    // For NAPS, use flexible matching
                    employeeQuery = `SELECT ROWID FROM Employee WHERE ContractorName LIKE '%NAPS%'`;
                } else {
                    // For other contractors, use exact match (case-insensitive)
                    employeeQuery = `SELECT ROWID FROM Employee WHERE LOWER(ContractorName) = LOWER('${escapedContractorName}')`;
                }
                
                try {
                    const employeeRows = await zcql.executeZCQLQuery(employeeQuery);
                    employeeIds = employeeRows.map(row => row.Employee.ROWID);
                    console.log(`Filtering shiftmaps for contractor: ${contractorName}, found ${employeeIds.length} employees`);
                } catch (error) {
                    console.error('Error fetching employees for contractor:', error);
                }
            }
        }
        
        // Build the query
        let query = 'SELECT ROWID, EmployeeId, Shift, Fromdate, Todate, AssignedShift, ActualShift, FirstIn, LastOut, DateWise, DateWiseShiftName, CREATEDTIME, MODIFIEDTIME FROM Shiftmap';
        
        // If we have employee IDs to filter by, add WHERE clause
        if (employeeIds.length > 0) {
            const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
            query += ` WHERE EmployeeId IN (${employeeIdList})`;
        }
        
        const rows = await zcql.executeZCQLQuery(query);
        const shiftmaps = rows.map(row => ({
            id: row.Shiftmap.ROWID,
            employeeId: row.Shiftmap.EmployeeId,
            shiftId: row.Shiftmap.Shift,
            fromdate: row.Shiftmap.Fromdate,
            todate: row.Shiftmap.Todate,
            assignedShift: row.Shiftmap.AssignedShift,
            actualShift: row.Shiftmap.ActualShift,
            firstIn: row.Shiftmap.FirstIn,
            lastOut: row.Shiftmap.LastOut,
            dateWise: row.Shiftmap.DateWise,
            dateWiseShiftName: row.Shiftmap.DateWiseShiftName,
            createdTime: row.Shiftmap.CREATEDTIME,
            modifiedTime: row.Shiftmap.MODIFIEDTIME
        }));
        res.status(200).send({ status: 'success', data: { shiftmaps } });
    } catch (err) {
        console.error('Error fetching shiftmaps:', err);
        res.status(500).send({ status: 'failure', message: "Couldn't fetch shift mappings." });
    }
});

// Add a new shift mapping
app.post('/shiftmaps', async (req, res) => {
    try {
        const { employeeId, shiftId, fromdate, todate, assignedShift, firstIn, lastOut, dateWise, dateWiseShiftName } = req.body;
        if (!employeeId || !shiftId || !fromdate || !todate) {
            return res.status(400).send({ status: 'failure', message: 'All fields are required.' });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Shiftmap');
        const newMap = await table.insertRow({
            EmployeeId: employeeId,
            Shift: shiftId,
            Fromdate: fromdate,
            Todate: todate,
            AssignedShift: assignedShift || null,
            ActualShift: null,
            FirstIn: firstIn || null,
            LastOut: lastOut || null,
            DateWise: dateWise || null,
            DateWiseShiftName: dateWiseShiftName || null
        });
        res.status(200).send({
            status: 'success',
            data: {
                shiftmap: {
                    id: newMap.ROWID,
                    employeeId: newMap.EmployeeId,
                    shiftId: newMap.Shift,
                    fromdate: newMap.Fromdate,
                    todate: newMap.Todate,
                    assignedShift: newMap.AssignedShift,
                    actualShift: newMap.ActualShift,
                    firstIn: newMap.FirstIn,
                    lastOut: newMap.LastOut,
                    dateWise: newMap.DateWise,
                    dateWiseShiftName: newMap.DateWiseShiftName,
                    createdTime: newMap.CREATEDTIME,
                    modifiedTime: newMap.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        res.status(400).send({ status: 'failure', message: err.message || 'Invalid input.' });
    }
});

// Update a shift mapping
app.put('/shiftmaps/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeId, shiftId, fromdate, todate, assignedShift, firstIn, lastOut, dateWise, dateWiseShiftName } = req.body;
        if (!employeeId || !shiftId || !fromdate || !todate) {
            return res.status(400).send({ status: 'failure', message: 'All fields are required.' });
        }
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Shiftmap');
        const updatedMap = await table.updateRow({
            ROWID: id,
            EmployeeId: employeeId,
            Shift: shiftId,
            Fromdate: fromdate,
            Todate: todate,
            AssignedShift: assignedShift || null,
            ActualShift: null,
            FirstIn: firstIn || null,
            LastOut: lastOut || null,
            DateWise: dateWise !== undefined ? dateWise : null,
            DateWiseShiftName: dateWiseShiftName !== undefined ? dateWiseShiftName : null
        });
        res.status(200).send({
            status: 'success',
            data: {
                shiftmap: {
                    id: updatedMap.ROWID,
                    employeeId: updatedMap.EmployeeId,
                    shiftId: updatedMap.Shift,
                    fromdate: updatedMap.Fromdate,
                    todate: updatedMap.Todate,
                    assignedShift: updatedMap.AssignedShift,
                    actualShift: updatedMap.ActualShift,
                    firstIn: updatedMap.FirstIn,
                    lastOut: updatedMap.LastOut,
                    dateWise: updatedMap.DateWise,
                    dateWiseShiftName: updatedMap.DateWiseShiftName,
                    createdTime: updatedMap.CREATEDTIME,
                    modifiedTime: updatedMap.MODIFIEDTIME
                }
            }
        });
    } catch (err) {
        res.status(400).send({ status: 'failure', message: err.message || 'Invalid input.' });
    }
});

// Delete a shift mapping
app.delete('/shiftmaps/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Shiftmap');
        await table.deleteRow(id);
        res.status(200).send({ status: 'success', message: 'Shift mapping deleted.' });
    } catch (err) {
        res.status(500).send({ status: 'failure', message: "Couldn't delete shift mapping." });
    }
});

module.exports = app;

