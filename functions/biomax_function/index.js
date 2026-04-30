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

// Helper: format date to YYYY-MM-DD HH:MM:SS
const formatDateTime = (dateInput) => {
  if (!dateInput) return null;
  
  // If it's already a string in YYYY-MM-DD format, convert to datetime
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    // If it's just a date (YYYY-MM-DD), convert to datetime (YYYY-MM-DD 00:00:00)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed} 00:00:00`;
    }
    // If it's already datetime format, use as is
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  
  // Try to parse as Date object
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

/**
 * GET /biomax
 * Fetch BioMax records with optional pagination
 */
app.get('/biomax', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.perPage, 10) || 50;
    const returnAll = !req.query.page && !req.query.perPage;

    const zcql = catalyst.zcql();

    const countQuery = 'SELECT COUNT(ROWID) as count FROM BioMax';
    const countRows = await zcql.executeZCQLQuery(countQuery);
    const total = parseInt(countRows?.[0]?.BioMax?.['COUNT(ROWID)'] ?? 0, 10);

    const selectColumns = [
      'ROWID',
      'CREATORID',
      'CREATEDTIME',
      'MODIFIEDTIME',
      'EmployeeCode',
      'EmployeeName',
      'LogDate'
    ];

    let records = [];

    if (returnAll) {
      // Fetch all records in batches (ZCQL has a 300 row limit per query)
      const batchSize = 300;
      let currentOffset = 0;
      let hasMore = true;

      console.log(`Fetching all ${total} BioMax records in batches of ${batchSize}...`);

      while (hasMore && records.length < total) {
        // ZCQL LIMIT syntax: LIMIT start, count (1-indexed)
        const startRow = currentOffset + 1;
        const batchQuery = `SELECT ${selectColumns.join(', ')} FROM BioMax ORDER BY ROWID DESC LIMIT ${startRow},${batchSize}`;
        
        try {
          const batchRows = await zcql.executeZCQLQuery(batchQuery);

          if (batchRows.length === 0) {
            hasMore = false;
			break;
	}

          const batchRecords = batchRows.map(entry => {
            const record = entry.BioMax || {};
            return {
              id: record.ROWID,
              employeeCode: record.EmployeeCode || null,
              employeeName: record.EmployeeName || null,
              logDate: record.LogDate || null,
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

      console.log(`Successfully fetched ${records.length} out of ${total} BioMax records`);
      
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
      const selectQuery = `SELECT ${selectColumns.join(', ')} FROM BioMax ORDER BY ROWID DESC ${limitClause}`;
      const rows = await zcql.executeZCQLQuery(selectQuery);

      records = rows.map(entry => {
        const record = entry.BioMax || {};
        return {
          id: record.ROWID,
          employeeCode: record.EmployeeCode || null,
          employeeName: record.EmployeeName || null,
          logDate: record.LogDate || null,
          createdTime: record.CREATEDTIME || null,
          modifiedTime: record.MODIFIEDTIME || null,
          creatorId: record.CREATORID || null
        };
      });
    }

    res.status(200).send({
      status: 'success',
      data: {
        biomax: records,
        total: returnAll ? records.length : total, // Use actual unique count when returning all
        page,
        perPage,
        totalPages: perPage ? Math.ceil(total / perPage) : 1
      }
    });
  } catch (error) {
    console.error('BioMax GET error:', error);
    res.status(500).send({
      status: 'failure',
      message: error.message || 'Failed to fetch BioMax records.'
    });
  }
});

/**
 * POST /biomax
 * Create a new BioMax record
 */
app.post('/biomax', async (req, res) => {
  try {
    const { employeeCode, employeeName, logDate } = req.body;
    if (!employeeCode || !employeeName || !logDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Employee Code, Employee Name, and LogDate are required.'
      });
    }

    const formattedLogDate = formatDateTime(logDate);
    if (!formattedLogDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Invalid date format for LogDate.'
      });
    }

    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('BioMax');

    const { ROWID } = await table.insertRow({
      EmployeeCode: employeeCode,
      EmployeeName: employeeName,
      LogDate: formattedLogDate
    });

    const row = await table.getRow(ROWID);

    res.status(200).send({
      status: 'success',
      data: {
        biomax: {
          id: row.ROWID,
          employeeCode: row.EmployeeCode || null,
          employeeName: row.EmployeeName || null,
          logDate: row.LogDate || null,
          createdTime: row.CREATEDTIME || null,
          modifiedTime: row.MODIFIEDTIME || null,
          creatorId: row.CREATORID || null
        }
      }
    });
  } catch (error) {
    console.error('BioMax POST error:', error);
    res.status(400).send({
      status: 'failure',
      message: error.message || 'Failed to create BioMax record.'
    });
  }
});

/**
 * POST /biomax/bulk
 * Bulk import BioMax records
 */
app.post('/biomax/bulk', async (req, res) => {
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
    
    console.log(`Bulk importing ${records.length} BioMax records...`);
    
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('BioMax');
    const zcql = catalyst.zcql();
    
    const results = {
      total: records.length,
      successful: 0,
      failed: 0,
      duplicates: 0,
      errors: []
    };
    
    // First, check for duplicates in the database
    // Build a set of existing records for quick lookup
    console.log('Checking for existing records to avoid duplicates...');
    const existingRecords = new Set();
    try {
      // Fetch all existing records in batches to build duplicate check set
      const batchSize = 300;
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const checkQuery = `SELECT EmployeeCode, EmployeeName, LogDate FROM BioMax ORDER BY ROWID DESC LIMIT ${offset + 1},${batchSize}`;
        const existingBatch = await zcql.executeZCQLQuery(checkQuery);
        
        if (existingBatch.length === 0) {
          hasMore = false;
          break;
        }
        
        existingBatch.forEach(entry => {
          const rec = entry.BioMax || {};
          const key = `${String(rec.EmployeeCode || '').trim()}_${String(rec.EmployeeName || '').trim()}_${String(rec.LogDate || '').trim()}`;
          existingRecords.add(key);
        });
        
        offset += existingBatch.length;
        if (existingBatch.length < batchSize) {
          hasMore = false;
        }
      }
      
      console.log(`Found ${existingRecords.size} existing records for duplicate checking`);
    } catch (checkError) {
      console.warn('Could not check for existing records, proceeding without duplicate check:', checkError);
    }
    
    // Process records in very small batches to avoid concurrency limit
    // Zoho Catalyst has strict concurrency limits, so we process 2-3 records at a time
    const concurrentLimit = 3; // Process 3 records concurrently (slightly faster)
    const delayBetweenBatches = 100; // 100ms delay between batches (reduced for speed)
    
    // Process records in small concurrent batches
    for (let i = 0; i < records.length; i += concurrentLimit) {
      const batch = records.slice(i, i + concurrentLimit);
      
      // Process small batch concurrently (2 records at a time) with retry logic
      const batchPromises = batch.map(async (record, batchIndex) => {
        const recordIndex = i + batchIndex;
        const maxRetries = 3;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
          try {
            const { employeeCode, employeeName, logDate } = record;
            
            if (!employeeCode || !employeeName || !logDate) {
              throw new Error('Employee Code, Employee Name, and LogDate are required.');
            }
            
            const formattedLogDate = formatDateTime(logDate);
            if (!formattedLogDate) {
              throw new Error('Invalid date format for LogDate.');
            }
            
            // Check for duplicate before inserting
            const recordKey = `${String(employeeCode).trim()}_${String(employeeName).trim()}_${formattedLogDate}`;
            if (existingRecords.has(recordKey)) {
              return { 
                success: false, 
                index: recordIndex, 
                error: 'Duplicate record (already exists)',
                record: record,
                isDuplicate: true
              };
            }
            
            await table.insertRow({
              EmployeeCode: String(employeeCode).trim(),
              EmployeeName: String(employeeName).trim(),
              LogDate: formattedLogDate
            });
            
            // Add to existing records set to prevent duplicates within the same import
            existingRecords.add(recordKey);
            
            return { success: true, index: recordIndex };
          } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            
            // If it's a concurrency error, retry with exponential backoff
            if (errorMessage.includes('Concurrency limit') && retryCount < maxRetries - 1) {
              retryCount++;
              const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5 seconds
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
        
        // If we get here, all retries failed
        return { 
          success: false, 
          index: recordIndex, 
          error: 'Failed after retries',
          record: record
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Count results
      batchResults.forEach(result => {
        if (result.success) {
          results.successful++;
        } else {
          if (result.isDuplicate) {
            results.duplicates++;
          } else {
            results.failed++;
          }
          results.errors.push({
            row: result.index + 2, // +2 because Excel rows start at 1 and have header
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
    
    console.log(`Bulk import completed: ${results.successful} successful, ${results.duplicates} duplicates, ${results.failed} failed out of ${results.total} total`);
    
    if (results.failed > 0 && results.successful === 0 && results.duplicates === 0) {
      // All imports failed
      return res.status(400).send({
        status: 'failure',
        message: `Failed to import all records. ${results.failed} record(s) failed.`,
        results: results
      });
    } else if (results.failed > 0 || results.duplicates > 0) {
      // Partial success with duplicates or failures
      let message = `Imported ${results.successful} record(s) successfully`;
      if (results.duplicates > 0) {
        message += `, ${results.duplicates} duplicate record(s) skipped`;
      }
      if (results.failed > 0) {
        message += `, ${results.failed} record(s) failed`;
      }
      return res.status(207).send({
        status: 'partial',
        message: message + '.',
        results: results
      });
    } else {
      // All successful
      return res.status(200).send({
        status: 'success',
        message: `Successfully imported ${results.successful} BioMax record(s).`,
        results: results
      });
    }
  } catch (error) {
    console.error('BioMax bulk import error:', error);
    return res.status(500).send({
      status: 'failure',
      message: error.message || 'Failed to import BioMax records.'
    });
  }
});

/**
 * PUT /biomax/:ROWID
 * Update BioMax record
 */
app.put('/biomax/:ROWID', async (req, res) => {
  try {
    const { ROWID } = req.params;
    const { employeeCode, employeeName, logDate } = req.body;

    if (!employeeCode || !employeeName || !logDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Employee Code, Employee Name, and LogDate are required.'
      });
    }

    const formattedLogDate = formatDateTime(logDate);
    if (!formattedLogDate) {
      return res.status(400).send({
        status: 'failure',
        message: 'Invalid date format for LogDate.'
      });
    }

    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('BioMax');

    await table.updateRow({
      ROWID,
      EmployeeCode: employeeCode,
      EmployeeName: employeeName,
      LogDate: formattedLogDate
    });

    const row = await table.getRow(ROWID);

    res.status(200).send({
      status: 'success',
      data: {
        biomax: {
          id: row.ROWID,
          employeeCode: row.EmployeeCode || null,
          employeeName: row.EmployeeName || null,
          logDate: row.LogDate || null,
          createdTime: row.CREATEDTIME || null,
          modifiedTime: row.MODIFIEDTIME || null,
          creatorId: row.CREATORID || null
        }
      }
    });
  } catch (error) {
    console.error('BioMax PUT error:', error);
    res.status(400).send({
      status: 'failure',
      message: error.message || 'Failed to update BioMax record.'
    });
  }
});

/**
 * DELETE /biomax/bulk
 * Delete multiple BioMax records
 */
app.delete('/biomax/bulk', async (req, res) => {
  try {
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('BioMax');
    
    const { ids } = req.body;
    console.log('=== BULK DELETE REQUEST START ===');
    console.log('Deleting BioMax records with IDs:', ids);
    
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
    
    console.log(`Attempting to delete ${ids.length} BioMax records...`);
    
    // Delete multiple records in parallel
    const deletePromises = ids.map(async (id) => {
      try {
        console.log(`Deleting BioMax record with ID: ${id}`);
        await table.deleteRow(id);
        console.log(`Successfully deleted BioMax record ${id}`);
        return { id, success: true };
      } catch (deleteError) {
        console.error(`Failed to delete BioMax record ${id}:`, deleteError);
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
        message: `Successfully deleted ${successful.length} BioMax record(s).`,
        successful: successful.length,
        failed: 0
      });
    }
  } catch (error) {
    console.error('=== BULK DELETE ERROR ===');
    console.error('BioMax bulk delete error:', error);
    return res.status(500).send({
      status: 'failure',
      message: error.message || 'Failed to delete BioMax records.'
    });
  }
});

/**
 * DELETE /biomax/:ROWID
 * Delete a single BioMax record
 */
app.delete('/biomax/:ROWID', async (req, res) => {
  try {
    const { ROWID } = req.params;
    const { catalyst } = res.locals;
    const table = catalyst.datastore().table('BioMax');

    await table.deleteRow(ROWID);

    res.status(200).send({
      status: 'success',
      message: 'BioMax record deleted successfully.'
    });
  } catch (error) {
    console.error('BioMax DELETE error:', error);
    res.status(400).send({
      status: 'failure',
      message: error.message || 'Failed to delete BioMax record.'
    });
  }
});

// Health check/root endpoint
app.get('/', (_, res) => {
  res.status(200).send({
    status: 'success',
    message: 'BioMax function is running.'
  });
});

module.exports = app;
