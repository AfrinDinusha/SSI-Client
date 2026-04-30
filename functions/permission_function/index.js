const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const catalyst = catalystSDK.initialize(req);
  res.locals.catalyst = catalyst;
  next();
});

// Table column names as in Data Store (Permission table)
const TABLE_NAME = 'Permission';

// GET: List all permission records (with optional pagination)
app.get('/permission', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 50;
    const zcql = catalyst.zcql();

    let total = 0;
    try {
      const countRows = await zcql.executeZCQLQuery(`SELECT COUNT(ROWID) as count FROM ${TABLE_NAME}`);
      total = parseInt(countRows[0]?.Permission?.['COUNT(ROWID)']) || 0;
    } catch (e) {
      console.error('Count query error:', e);
    }

    const returnAll = !req.query.page && !req.query.perPage;
    const limitClause = returnAll ? '' : `LIMIT ${(page - 1) * perPage + 1},${perPage}`;

    const queryColumns = [
      'ROWID', 'EmployeeCode', 'EmployeeName', 'PermissionApplicableTo', 'PermissionTime', 'PermissionEndTime', 'PermissionDate',
      'CREATEDTIME', 'MODIFIEDTIME', 'CREATORID'
    ];
    const queryString = `SELECT ${queryColumns.join(', ')} FROM ${TABLE_NAME} ORDER BY ROWID DESC ${limitClause}`;

    let rows = [];
    try {
      const queryResult = await zcql.executeZCQLQuery(queryString);
      rows = (queryResult || []).map((row) => {
        const p = row.Permission || {};
        return {
          id: String(p.ROWID || ''),
          employeeCode: p.EmployeeCode || '',
          employeeName: p.EmployeeName || '',
          permissionApplicableTo: p.PermissionApplicableTo || '',
          permissionTime: p.PermissionTime || '',
          permissionEndTime: p.PermissionEndTime || '',
          permissionDate: p.PermissionDate || '',
          createdTime: p.CREATEDTIME || null,
          modifiedTime: p.MODIFIEDTIME || null,
          creatorId: p.CREATORID != null ? String(p.CREATORID) : '',
        };
      });
    } catch (e) {
      console.error('Query error:', e);
    }

    const hasMore = returnAll ? false : page * perPage < total;

    res.status(200).json({
      status: 'success',
      data: {
        permissions: rows,
        total,
        page,
        perPage,
        hasMore,
      },
    });
  } catch (err) {
    console.error('Get permission list error:', err);
    res.status(500).json({
      status: 'failure',
      message: 'Failed to fetch permission records: ' + err.message,
    });
  }
});

// GET: Single permission by id
app.get('/permission/:id', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const id = req.params.id;
    const zcql = catalyst.zcql();

    const queryString = `SELECT ROWID, EmployeeCode, EmployeeName, PermissionApplicableTo, PermissionTime, PermissionEndTime, PermissionDate, CREATEDTIME, MODIFIEDTIME, CREATORID FROM ${TABLE_NAME} WHERE ROWID = ${id}`;
    const queryResult = await zcql.executeZCQLQuery(queryString);

    if (!queryResult || queryResult.length === 0) {
      return res.status(404).json({
        status: 'failure',
        message: 'Permission record not found',
      });
    }

    const p = queryResult[0].Permission;
    const result = {
      id: String(p.ROWID || id),
      employeeCode: p.EmployeeCode || '',
      employeeName: p.EmployeeName || '',
      permissionApplicableTo: p.PermissionApplicableTo || '',
      permissionTime: p.PermissionTime || '',
      permissionEndTime: p.PermissionEndTime || '',
      permissionDate: p.PermissionDate || '',
      createdTime: p.CREATEDTIME || null,
      modifiedTime: p.MODIFIEDTIME || null,
      creatorId: p.CREATORID != null ? String(p.CREATORID) : '',
    };

    res.status(200).json({
      status: 'success',
      data: { permission: result },
    });
  } catch (err) {
    console.error('Get permission by id error:', err);
    res.status(500).json({
      status: 'failure',
      message: 'Failed to fetch permission record: ' + err.message,
    });
  }
});

// POST: Create permission
app.post('/permission', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const datastore = catalyst.datastore();
    const table = datastore.table(TABLE_NAME);

    const { employeeCode, employeeName, permissionApplicableTo, permissionTime, permissionEndTime, permissionDate } = req.body;

    if (!(employeeCode && String(employeeCode).trim())) {
      return res.status(400).json({
        status: 'failure',
        message: 'Employee Code is required',
      });
    }

    // Use only column names that exist in the Permission table; all values as strings to avoid INVALID_INPUT
    const rowData = {
      EmployeeCode: String(employeeCode).trim(),
      EmployeeName: String(employeeName || '').trim(),
      PermissionApplicableTo: String(permissionApplicableTo || '').trim(),
      PermissionTime: String(permissionTime || '').trim(),
      PermissionEndTime: String(permissionEndTime || '').trim(),
      PermissionDate: String(permissionDate || '').trim(),
    };

    const inserted = await table.insertRow(rowData);
    const zcql = catalyst.zcql();
    const queryString = `SELECT ROWID, EmployeeCode, EmployeeName, PermissionApplicableTo, PermissionTime, PermissionEndTime, PermissionDate, CREATEDTIME, MODIFIEDTIME, CREATORID FROM ${TABLE_NAME} WHERE ROWID = ${inserted.ROWID}`;
    const queryResult = await zcql.executeZCQLQuery(queryString);

    if (!queryResult || queryResult.length === 0) {
      throw new Error('Failed to fetch inserted record');
    }

    const p = queryResult[0].Permission;
    const result = {
      id: String(p.ROWID || inserted.ROWID),
      employeeCode: p.EmployeeCode || '',
      employeeName: p.EmployeeName || '',
      permissionApplicableTo: p.PermissionApplicableTo || '',
      permissionTime: p.PermissionTime || '',
      permissionEndTime: p.PermissionEndTime || '',
      permissionDate: p.PermissionDate || '',
      createdTime: p.CREATEDTIME || null,
      modifiedTime: p.MODIFIEDTIME || null,
      creatorId: p.CREATORID != null ? String(p.CREATORID) : '',
    };

    res.status(201).json({
      status: 'success',
      message: 'Permission record created successfully',
      data: { permission: result },
    });
  } catch (err) {
    console.error('Create permission error:', err);
    const isInvalidColumn = err.code === 'INVALID_INPUT';
    const message = isInvalidColumn
      ? 'Data Store rejected the request (INVALID_INPUT). Ensure: (1) Permission table has columns exactly: EmployeeCode, EmployeeName, PermissionApplicableTo, PermissionTime, PermissionEndTime, PermissionDate. (2) Table Permissions allow Insert for your role (Catalyst Console → Data Store → Permission → Scopes and Permissions).'
      : 'Failed to create permission record: ' + (err.message || err.code || 'Unknown error');
    res.status(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).json({
      status: 'failure',
      message,
    });
  }
});

// PUT: Update permission
app.put('/permission/:id', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const id = req.params.id;
    const datastore = catalyst.datastore();
    const table = datastore.table(TABLE_NAME);

    const { employeeCode, employeeName, permissionApplicableTo, permissionTime, permissionEndTime, permissionDate } = req.body;

    if (!(employeeCode && String(employeeCode).trim())) {
      return res.status(400).json({
        status: 'failure',
        message: 'Employee Code is required',
      });
    }

    const rowData = {
      ROWID: id,
      EmployeeCode: String(employeeCode).trim(),
      EmployeeName: String(employeeName || '').trim(),
      PermissionApplicableTo: String(permissionApplicableTo || '').trim(),
      PermissionTime: String(permissionTime || '').trim(),
      PermissionDate: String(permissionDate || '').trim(),
    };
    if (String(permissionEndTime || '').trim() !== '') {
      rowData.PermissionEndTime = String(permissionEndTime).trim();
    } else {
      rowData.PermissionEndTime = '';
    }

    await table.updateRow(rowData);
    const updated = await table.getRow(id);

    const result = {
      id: String(updated.ROWID || id),
      employeeCode: updated.EmployeeCode || '',
      employeeName: updated.EmployeeName || '',
      permissionApplicableTo: updated.PermissionApplicableTo || '',
      permissionTime: updated.PermissionTime || '',
      permissionEndTime: updated.PermissionEndTime || '',
      permissionDate: updated.PermissionDate || '',
      createdTime: updated.CREATEDTIME || null,
      modifiedTime: updated.MODIFIEDTIME || null,
      creatorId: updated.CREATORID != null ? String(updated.CREATORID) : '',
    };

    res.status(200).json({
      status: 'success',
      message: 'Permission record updated successfully',
      data: { permission: result },
    });
  } catch (err) {
    console.error('Update permission error:', err);
    res.status(500).json({
      status: 'failure',
      message: 'Failed to update permission record: ' + err.message,
    });
  }
});

// DELETE: Remove permission
app.delete('/permission/:id', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const id = req.params.id;
    const datastore = catalyst.datastore();
    const table = datastore.table(TABLE_NAME);

    await table.deleteRow(id);

    res.status(200).json({
      status: 'success',
      message: 'Permission record deleted successfully',
    });
  } catch (err) {
    console.error('Delete permission error:', err);
    res.status(500).json({
      status: 'failure',
      message: 'Failed to delete permission record: ' + err.message,
    });
  }
});

module.exports = app;
