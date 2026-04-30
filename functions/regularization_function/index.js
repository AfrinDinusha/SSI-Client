'use strict';

const express = require('express');
const catalystSDK = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

// Attach Catalyst SDK instance for every request
app.use((req, res, next) => {
  const catalyst = catalystSDK.initialize(req);
  res.locals.catalyst = catalyst;
  next();
});

// Helper: format date to YYYY-MM-DD
const formatDate = (dateInput) => {
  if (!dateInput) return null;
  
  // If it's already a string in YYYY-MM-DD format, return as is
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  
  // Try to parse as Date object
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper: escape single quotes for ZCQL string literals
const escapeForZCQL = (val) => (val == null ? '' : String(val).replace(/'/g, "''"));

// Normalize time string to HH:mm:ss for comparison (earliest = min, latest = max)
const toTimeComparable = (str) => {
  if (str == null || String(str).trim() === '') return null;
  const s = String(str).trim();
  const match = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, h, m, sec] = match;
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${(sec || '00').padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toTimeString().slice(0, 8);
  return null;
};

// Return the earlier of two time values (for FirstIn)
const earliestTime = (a, b) => {
  const ta = toTimeComparable(a);
  const tb = toTimeComparable(b);
  if (!ta) return b != null ? b : a;
  if (!tb) return a != null ? a : b;
  return ta <= tb ? (a != null ? a : b) : (b != null ? b : a);
};

// Return the latest of two time values (for LastOut / checkout)
const latestTime = (a, b) => {
  const ta = toTimeComparable(a);
  const tb = toTimeComparable(b);
  if (!ta) return b != null ? b : a;
  if (!tb) return a != null ? a : b;
  return ta >= tb ? (a != null ? a : b) : (b != null ? b : a);
};

/**
 * Get existing Regularization row by EmployeeCode + LogDate.
 * @returns {Promise<{ rowId, firstIn, lastOut, employeeName }|null>}
 */
async function getExistingRow(zcql, employeeCode, logDate) {
  const ec = escapeForZCQL(employeeCode);
  const ld = escapeForZCQL(logDate);
  const q = `SELECT ROWID, FirstIn, LastOut, EmployeeName FROM Regularization WHERE EmployeeCode = '${ec}' AND LogDate = '${ld}' LIMIT 1,1`;
  const rows = await zcql.executeZCQLQuery(q);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0].Regularization || {};
  return {
    rowId: r.ROWID,
    firstIn: r.FirstIn || null,
    lastOut: r.LastOut || null,
    employeeName: r.EmployeeName || null
  };
}

/**
 * GET /regularization
 * Fetch Regularization records with optional pagination
 */
app.get('/regularization', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.perPage, 10) || 50;
    const returnAll = !req.query.page && !req.query.perPage;

    const zcql = catalyst.zcql();

    const countQuery = 'SELECT COUNT(ROWID) as count FROM Regularization';
    const countRows = await zcql.executeZCQLQuery(countQuery);
    const total = parseInt(countRows?.[0]?.Regularization?.['COUNT(ROWID)'] ?? 0, 10);

    const selectColumns = [
      'ROWID',
      'CREATORID',
      'CREATEDTIME',
      'MODIFIEDTIME',
      'EmployeeCode',
      'EmployeeName',
      'LogDate',
      'FirstIn',
      'LastOut'
    ];

    let records = [];

    if (returnAll) {
      // Fetch all records in batches (ZCQL has a 300 row limit per query)
      const batchSize = 300;
      let currentOffset = 0;
      let hasMore = true;

      console.log(`Fetching all ${total} Regularization records in batches of ${batchSize}...`);

      while (hasMore && records.length < total) {
        // ZCQL LIMIT syntax: LIMIT start, count (1-indexed)
        const startRow = currentOffset + 1;
        const batchQuery = `SELECT ${selectColumns.join(', ')} FROM Regularization ORDER BY ROWID DESC LIMIT ${startRow},${batchSize}`;
        
        try {
          const batchRows = await zcql.executeZCQLQuery(batchQuery);

          if (batchRows.length === 0) {
            hasMore = false;
            break;
          }

          const batchRecords = batchRows.map(entry => {
            const record = entry.Regularization || {};
            return {
              id: record.ROWID,
              employeeCode: record.EmployeeCode || null,
              employeeName: record.EmployeeName || null,
              logDate: record.LogDate || null,
              firstIn: record.FirstIn || null,
              lastOut: record.LastOut || null,
              createdTime: record.CREATEDTIME || null,
              modifiedTime: record.MODIFIEDTIME || null,
              creatorId: record.CREATORID || null
            };
          });

          records = records.concat(batchRecords);
          currentOffset += batchRows.length;

          // If we got fewer records than batch size, we've reached the end
          if (batchRows.length < batchSize || records.length >= total) {
            hasMore = false;
          }

          console.log(`Fetched ${records.length}/${total} records...`);
        } catch (batchError) {
          console.error(`Error fetching batch at offset ${currentOffset}:`, batchError);
          // If we hit an error, try to continue with what we have
          hasMore = false;
        }
      }

      console.log(`Successfully fetched ${records.length} out of ${total} Regularization records`);
      
      // Remove duplicates based on ROWID (in case of any overlap in batch fetching)
      const uniqueRecordsMap = new Map();
      records.forEach(record => {
        if (record.id && !uniqueRecordsMap.has(record.id)) {
          uniqueRecordsMap.set(record.id, record);
        }
      });
      records = Array.from(uniqueRecordsMap.values());
      
      // Sort by ROWID DESC to maintain order
      records.sort((a, b) => {
        const idA = parseInt(a.id) || 0;
        const idB = parseInt(b.id) || 0;
        return idB - idA;
      });
      
      console.log(`After deduplication: ${records.length} unique records`);
    } else {
      // Paginated request
      const limitClause = `LIMIT ${(page - 1) * perPage + 1},${perPage}`;
      const selectQuery = `SELECT ${selectColumns.join(', ')} FROM Regularization ORDER BY ROWID DESC ${limitClause}`;
      const rows = await zcql.executeZCQLQuery(selectQuery);

      records = rows.map(entry => {
        const record = entry.Regularization || {};
        return {
          id: record.ROWID,
          employeeCode: record.EmployeeCode || null,
          employeeName: record.EmployeeName || null,
          logDate: record.LogDate || null,
          firstIn: record.FirstIn || null,
          lastOut: record.LastOut || null,
          createdTime: record.CREATEDTIME || null,
          modifiedTime: record.MODIFIEDTIME || null,
          creatorId: record.CREATORID || null
        };
      });
    }

    res.status(200).send({
      status: 'success',
      data: {
        regularization: records,
        total: returnAll ? records.length : total, // Use actual unique count when returning all
        page,
        perPage,
        totalPages: perPage ? Math.ceil(total / perPage) : 1
      }
    });
  } catch (error) {
    console.error('Regularization GET error:', error);
    res.status(500).send({
      status: 'failure',
      message: error.message || 'Failed to fetch Regularization records.'
    });
  }
});

/**
 * POST /regularization
 * Create a new Regularization record
 */
app.post('/regularization', async (req, res) => {
  try {
    const { employeeCode, employeeName, logDate, firstIn, lastOut } = req.body;
    if (!employeeCode || !logDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Employee Code and LogDate are required.'
      });
    }

    const formattedLogDate = formatDate(logDate);
    if (!formattedLogDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Invalid date format for LogDate.'
      });
    }

    const { catalyst } = res.locals;
    const zcql = catalyst.zcql();
    const table = catalyst.datastore().table('Regularization');

    const existing = await getExistingRow(zcql, employeeCode, formattedLogDate);
    if (existing) {
      const mergedFirstIn = earliestTime(existing.firstIn, firstIn);
      const mergedLastOut = latestTime(existing.lastOut, lastOut);
      const nameToUse = employeeName || existing.employeeName || null;
      await table.updateRow({
        ROWID: existing.rowId,
        EmployeeCode: employeeCode,
        EmployeeName: nameToUse,
        LogDate: formattedLogDate,
        FirstIn: mergedFirstIn,
        LastOut: mergedLastOut
      });
      const row = await table.getRow(existing.rowId);
      return res.status(200).send({
        status: 'success',
        data: {
          regularization: {
            id: row.ROWID,
            employeeCode: row.EmployeeCode || null,
            employeeName: row.EmployeeName || null,
            logDate: row.LogDate || null,
            firstIn: row.FirstIn || null,
            lastOut: row.LastOut || null,
            createdTime: row.CREATEDTIME || null,
            modifiedTime: row.MODIFIEDTIME || null,
            creatorId: row.CREATORID || null
          },
          merged: true
        }
      });
    }

    const { ROWID } = await table.insertRow({
      EmployeeCode: employeeCode,
      EmployeeName: employeeName || null,
      LogDate: formattedLogDate,
      FirstIn: firstIn || null,
      LastOut: lastOut || null
    });

    const row = await table.getRow(ROWID);

    res.status(200).send({
      status: 'success',
      data: {
        regularization: {
          id: row.ROWID,
          employeeCode: row.EmployeeCode || null,
          employeeName: row.EmployeeName || null,
          logDate: row.LogDate || null,
          firstIn: row.FirstIn || null,
          lastOut: row.LastOut || null,
          createdTime: row.CREATEDTIME || null,
          modifiedTime: row.MODIFIEDTIME || null,
          creatorId: row.CREATORID || null
        }
      }
    });
  } catch (error) {
    console.error('Regularization POST error:', error);
    res.status(400).send({
      status: 'failure',
      message: error.message || 'Failed to create Regularization record.'
    });
  }
});

/**
 * POST /regularization/bulk
 * Bulk import Regularization records
 */
app.post('/regularization/bulk', async (req, res) => {
  try {
    const { records } = req.body;
    
    if (!records || !Array.isArray(records)) {
      return res.status(400).send({
        status: 'failure',
        message: 'Records array is required for bulk import.'
      });
    }
    
    if (records.length === 0) {
      return res.status(400).send({
        status: 'failure',
        message: 'At least one record is required.'
      });
    }
    
    console.log(`Bulk importing ${records.length} Regularization records...`);
    
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Regularization');
    const zcql = catalyst.zcql();
    
    const results = {
      total: records.length,
      successful: 0,
      failed: 0,
      merged: 0,
      errors: []
    };
    
    // Same EmployeeCode + LogDate: merge into one record (earliest FirstIn, latest LastOut)
    const concurrentLimit = 3;
    const delayBetweenBatches = 100;
    
    for (let i = 0; i < records.length; i += concurrentLimit) {
      const batch = records.slice(i, i + concurrentLimit);
      
      const batchPromises = batch.map(async (record, batchIndex) => {
        const recordIndex = i + batchIndex;
        const maxRetries = 3;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
          try {
            const { employeeCode, employeeName, logDate, firstIn, lastOut } = record;
            
            if (!employeeCode || !logDate) {
              throw new Error('Employee Code and LogDate are required.');
            }
            
            const formattedLogDate = formatDate(logDate);
            if (!formattedLogDate) {
              throw new Error('Invalid date format for LogDate.');
            }
            
            const code = String(employeeCode).trim();
            const name = employeeName ? String(employeeName).trim() : null;
            const fi = firstIn ? String(firstIn).trim() : null;
            const lo = lastOut ? String(lastOut).trim() : null;
            
            const existing = await getExistingRow(zcql, code, formattedLogDate);
            if (existing) {
              const mergedFirstIn = earliestTime(existing.firstIn, fi);
              const mergedLastOut = latestTime(existing.lastOut, lo);
              const nameToUse = name || existing.employeeName || null;
              await table.updateRow({
                ROWID: existing.rowId,
                EmployeeCode: code,
                EmployeeName: nameToUse,
                LogDate: formattedLogDate,
                FirstIn: mergedFirstIn,
                LastOut: mergedLastOut
              });
              return { success: true, merged: true, index: recordIndex };
            }
            
            await table.insertRow({
              EmployeeCode: code,
              EmployeeName: name,
              LogDate: formattedLogDate,
              FirstIn: fi,
              LastOut: lo
            });
            
            return { success: true, merged: false, index: recordIndex };
          } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            
            if (errorMessage.includes('Concurrency limit') && retryCount < maxRetries - 1) {
              retryCount++;
              const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
              console.log(`Concurrency limit hit for record ${recordIndex + 2}, retrying (${retryCount}/${maxRetries}) after ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            
            return { 
              success: false, 
              index: recordIndex, 
              error: errorMessage,
              record: record
            };
          }
        }
        
        return { 
          success: false, 
          index: recordIndex, 
          error: 'Failed after retries',
          record: record
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.success) {
          results.successful++;
          if (result.merged) results.merged++;
        } else {
          results.failed++;
          results.errors.push({
            row: result.index + 2,
            error: result.error,
            record: result.record
          });
        }
      });
      
      // Add delay between batches to avoid overwhelming the system
      if (i + concurrentLimit < records.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
      
      // Log progress for large imports
      if (records.length > 100) {
        const processed = Math.min(i + concurrentLimit, records.length);
        console.log(`Progress: ${processed}/${records.length} records processed (${results.successful} successful, ${results.failed} failed)`);
      }
    }
    
    console.log(`Bulk import completed: ${results.successful} successful, ${results.failed} failed out of ${results.total} total`);
    
    if (results.failed > 0 && results.successful === 0) {
      // All imports failed
      return res.status(400).send({
        status: 'failure',
        message: `Failed to import all records. ${results.failed} record(s) failed.`,
        results: results
      });
    } else if (results.failed > 0) {
      return res.status(207).send({
        status: 'partial',
        message: `Imported ${results.successful} record(s) successfully (${results.merged} merged). ${results.failed} failed.`,
        results: results
      });
    } else {
      const mergedText = results.merged > 0 ? ` (${results.merged} merged with existing)` : '';
      return res.status(200).send({
        status: 'success',
        message: `Successfully imported ${results.successful} Regularization record(s).${mergedText}`,
        results: results
      });
    }
  } catch (error) {
    console.error('Regularization bulk import error:', error);
    return res.status(500).send({
      status: 'failure',
      message: error.message || 'Failed to import Regularization records.'
    });
  }
});

/**
 * PUT /regularization/:ROWID
 * Update Regularization record
 */
app.put('/regularization/:ROWID', async (req, res) => {
  try {
    const { ROWID } = req.params;
    const { employeeCode, employeeName, logDate, firstIn, lastOut } = req.body;

    if (!employeeCode || !logDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Employee Code and LogDate are required.'
      });
    }

    const formattedLogDate = formatDate(logDate);
    if (!formattedLogDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Invalid date format for LogDate.'
      });
    }

    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Regularization');

    await table.updateRow({
      ROWID,
      EmployeeCode: employeeCode,
      EmployeeName: employeeName || null,
      LogDate: formattedLogDate,
      FirstIn: firstIn || null,
      LastOut: lastOut || null
    });

    const row = await table.getRow(ROWID);

    res.status(200).send({
      status: 'success',
      data: {
        regularization: {
          id: row.ROWID,
          employeeCode: row.EmployeeCode || null,
          employeeName: row.EmployeeName || null,
          logDate: row.LogDate || null,
          firstIn: row.FirstIn || null,
          lastOut: row.LastOut || null,
          createdTime: row.CREATEDTIME || null,
          modifiedTime: row.MODIFIEDTIME || null,
          creatorId: row.CREATORID || null
        }
      }
    });
  } catch (error) {
    console.error('Regularization PUT error:', error);
    res.status(400).send({
      status: 'failure',
      message: error.message || 'Failed to update Regularization record.'
    });
  }
});

/**
 * DELETE /regularization/bulk
 * Delete multiple Regularization records
 */
app.delete('/regularization/bulk', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Regularization');
    
    const { ids } = req.body;
    console.log('=== BULK DELETE REQUEST START ===');
    console.log('Deleting Regularization records with IDs:', ids);
    
    if (!ids || !Array.isArray(ids)) {
      console.error('Invalid request: IDs array is required');
      return res.status(400).send({
        status: 'failure',
        message: 'Invalid request. IDs array is required.'
      });
    }
    
    if (ids.length === 0) {
      console.error('Invalid request: Empty IDs array');
      return res.status(400).send({
        status: 'failure',
        message: 'Invalid request. At least one ID is required.'
      });
    }
    
    console.log(`Attempting to delete ${ids.length} Regularization records...`);
    
    // Delete multiple records in parallel
    const deletePromises = ids.map(async (id) => {
      try {
        console.log(`Deleting Regularization record with ID: ${id}`);
        await table.deleteRow(id);
        console.log(`Successfully deleted Regularization record ${id}`);
        return { id, success: true };
      } catch (deleteError) {
        console.error(`Failed to delete Regularization record ${id}:`, deleteError);
        return { id, success: false, error: deleteError.message };
      }
    });
    
    const results = await Promise.all(deletePromises);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log('Delete results:', { successful: successful.length, failed: failed.length });
    console.log('Successful deletions:', successful.map(r => r.id));
    if (failed.length > 0) {
      console.log('Failed deletions:', failed.map(r => ({ id: r.id, error: r.error })));
    }
    
    if (failed.length > 0 && successful.length === 0) {
      // All deletions failed
      return res.status(400).send({
        status: 'failure',
        message: `Failed to delete all records. ${failed.length} record(s) failed.`,
        successful: successful.length,
        failed: failed.length,
        errors: failed.map(r => ({ id: r.id, error: r.error }))
      });
    } else if (failed.length > 0) {
      // Some deletions failed
      return res.status(207).send({
        status: 'partial',
        message: `Deleted ${successful.length} record(s) successfully, but ${failed.length} record(s) failed.`,
        successful: successful.length,
        failed: failed.length,
        errors: failed.map(r => ({ id: r.id, error: r.error }))
      });
    } else {
      // All deletions succeeded
      console.log('=== BULK DELETE REQUEST END (SUCCESS) ===');
      return res.status(200).send({
        status: 'success',
        message: `Successfully deleted ${successful.length} Regularization record(s).`,
        successful: successful.length,
        failed: 0
      });
    }
  } catch (error) {
    console.error('=== BULK DELETE ERROR ===');
    console.error('Regularization bulk delete error:', error);
    return res.status(500).send({
      status: 'failure',
      message: error.message || 'Failed to delete Regularization records.'
    });
  }
});

/**
 * DELETE /regularization/:ROWID
 * Delete a single Regularization record
 */
app.delete('/regularization/:ROWID', async (req, res) => {
  try {
    const { ROWID } = req.params;
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('Regularization');

    await table.deleteRow(ROWID);

    res.status(200).send({
      status: 'success',
      message: 'Regularization record deleted successfully.'
    });
  } catch (error) {
    console.error('Regularization DELETE error:', error);
    res.status(400).send({
      status: 'failure',
      message: error.message || 'Failed to delete Regularization record.'
    });
  }
});

// Health check/root endpoint
app.get('/', (_, res) => {
  res.status(200).send({
    status: 'success',
    message: 'Regularization function is running.'
  });
});

module.exports = app;
