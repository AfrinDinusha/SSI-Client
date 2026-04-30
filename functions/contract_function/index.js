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

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send({
        status: 'success',
        message: 'Contract function is running',
        timestamp: new Date().toISOString()
    });
});

// Test endpoint to check table access
app.get('/test-table', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('contract');
        
        // Try to get table info
        const tableInfo = await table.getTableInfo();
        console.log('Table info:', tableInfo);
        
        res.status(200).send({
            status: 'success',
            message: 'Table access successful',
            tableInfo: tableInfo
        });
    } catch (err) {
        console.error('Table access error:', err);
        res.status(500).send({
            status: 'failure',
            message: 'Table access failed',
            error: err.message
        });
    }
});

// Helper function to format date from dd-MMM-yyyy to yyyy-MM-dd
function formatDateForStorage(dateStr) {
    if (!dateStr || dateStr.trim() === '') return null;
    
    // Parse dd-MMM-yyyy format (e.g., "01-Jan-2024" or "31-dec-2025")
    const months = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = months[parts[1]];
        const year = parts[2];
        
        if (month) {
            return `${year}-${month}-${day}`;
        }
    }
    
    // If parsing fails, try to return a valid date format or null
    console.log('Date parsing failed for:', dateStr);
    return null;
}

// Helper function to clean date values
function cleanDate(value) {
    if (!value || value === '') return null;
    return formatDateForStorage(value);
}

// GET API: Get all contracts
app.get('/contracts', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const table = catalyst.datastore().table('contract');

        const allRows = await table.getAllRows();
        console.log('Fetched contract rows:', allRows.length);
        
        const total = allRows.length;
        const contracts = allRows
            .slice((page - 1) * perPage, page * perPage)
            .map(row => ({
                id: row.ROWID,
                ...row
            }));

        res.status(200).send({
            status: 'success',
            data: {
                contracts,
                hasMore: page * perPage < total,
                total: total
            }
        });
    } catch (err) {
        console.log('GET /contracts error:', err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// POST API: Add a new contract
app.post('/contracts', async (req, res) => {
    try {
        const body = req.body;
        console.log('Creating new contract with data:', body);
        
        // Validate mandatory fields
        if (!body.organizationName || !body.contractor || !body.natureOfContract || !body.registerDate) {
            console.log('Validation failed - missing required fields:', {
                organizationName: !!body.organizationName,
                contractor: !!body.contractor,
                natureOfContract: !!body.natureOfContract,
                registerDate: !!body.registerDate
            });
            return res.status(400).send({
                status: 'failure',
                message: 'Organization Name, Contractor, Nature of Contract, and Register Date are required.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('contract');
        
        // Prepare the payload with proper field mapping
        const payload = {
            Organizationname: body.organizationName,
            contractor: body.contractor,
            Natureofcontract: body.natureOfContract,
            Numberofemployees: body.numberOfEmployees ? parseInt(body.numberOfEmployees) : null,
            status: body.status || 'Active',
            RegisterDate: cleanDate(body.registerDate),
            completedDate: cleanDate(body.dateOfCompletion)
        };

        console.log('Attempting to insert contract with payload:', payload);
        console.log('Payload details:', {
            Organizationname: payload.Organizationname,
            contractor: payload.contractor,
            Natureofcontract: payload.Natureofcontract,
            Numberofemployees: payload.Numberofemployees,
            status: payload.status,
            RegisterDate: payload.RegisterDate,
            completedDate: payload.completedDate
        });
        
        const { ROWID: id } = await table.insertRow(payload);
        console.log('Contract created successfully with ID:', id);
        
        res.status(200).send({
            status: 'success',
            data: { contract: { id, ...payload } }
        });
    } catch (err) {
        console.error('Error creating contract:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        res.status(500).send({
            status: 'failure',
            message: err.message || "Failed to create contract. Please check the server logs."
        });
    }
});

// PUT API: Update a contract by ROWID
app.put('/contracts/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const body = req.body;
        console.log('Updating contract with data:', body);
        
        // Validate mandatory fields
        if (!body.organizationName || !body.contractor || !body.natureOfContract || !body.registerDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'Organization Name, Contractor, Nature of Contract, and Register Date are required.'
            });
        }
        
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('contract');
        
        // Prepare the payload with proper field mapping
        const payload = {
            Organizationname: body.organizationName,
            contractor: body.contractor,
            Natureofcontract: body.natureOfContract,
            Numberofemployees: body.numberOfEmployees ? parseInt(body.numberOfEmployees) : null,
            status: body.status || 'Active',
            RegisterDate: cleanDate(body.registerDate),
            completedDate: cleanDate(body.dateOfCompletion)
        };
        
        const updatedRow = await table.updateRow({ ROWID, ...payload });
        console.log('Contract updated successfully with ID:', ROWID);
        
        res.status(200).send({
            status: 'success',
            data: { contract: { id: ROWID, ...payload } }
        });
    } catch (err) {
        console.error('Error updating contract:', err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// DELETE API: Delete a contract by ROWID
app.delete('/contracts/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('contract');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: { contract: { id: ROWID } }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// GET API: Get contract count
app.get('/contracts/count', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('contract');
        const allRows = await table.getAllRows();
        res.json({ count: allRows.length });
    } catch (err) {
        console.error('Contract count error:', err);
        res.status(500).json({ error: 'Failed to get contract count' });
    }
});

module.exports = app;
