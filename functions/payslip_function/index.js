'use strict';

const catalyst = require('zcatalyst-sdk-node');

const PAYSLIP_TEMPLATE_TABLE = 'PayslipTemplate';
const COMPONENTS_COLUMN = 'Components';
const APPLICABLE_COLUMN = 'Appicable';

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = async (req, res) => {
  const url = (req.url || '').split('?')[0];
  const method = req.method || 'GET';

  // GET: Load payslip template from PayslipTemplate datastore
  if (method === 'GET' && (url === '/getPayslipTemplate' || url.endsWith('/getPayslipTemplate'))) {
    try {
      const catalystApp = catalyst.initialize(req);
      const table = catalystApp.datastore().table(PAYSLIP_TEMPLATE_TABLE);
      const rows = await table.getAllRows();
      const row = rows && rows[0];
      const componentsJson = row && (row[COMPONENTS_COLUMN] != null) ? String(row[COMPONENTS_COLUMN]) : '';
      let config = {};
      if (componentsJson.trim()) {
        try {
          config = JSON.parse(componentsJson);
        } catch (_) {}
      }
      const companyName = typeof config.companyName === 'string' ? config.companyName : '';
      const earningKeys = Array.isArray(config.earningKeys) ? config.earningKeys : [];
      const deductionKeys = Array.isArray(config.deductionKeys) ? config.deductionKeys : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        companyName,
        earningKeys,
        deductionKeys,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // POST: Save payslip template (earnings + deductions) to PayslipTemplate datastore
  if (method === 'POST' && (url === '/savePayslip' || url.endsWith('/savePayslip'))) {
    try {
      const data = await parseBody(req);
      const companyName = typeof data.companyName === 'string' ? data.companyName.trim() : '';
      const earningKeys = Array.isArray(data.earningKeys) ? data.earningKeys : [];
      const deductionKeys = Array.isArray(data.deductionKeys) ? data.deductionKeys : [];

      const catalystApp = catalyst.initialize(req);
      const table = catalystApp.datastore().table(PAYSLIP_TEMPLATE_TABLE);
      const config = {
        companyName: companyName || 'S S INDUSTRIES',
        earningKeys,
        deductionKeys,
      };
      const componentsValue = JSON.stringify(config);

      const rows = await table.getAllRows();
      if (rows && rows.length > 0) {
        const existing = rows[0];
        const rowId = existing.ROWID != null ? existing.ROWID : existing.Rowid;
        await table.updateRow({
          ROWID: rowId,
          [COMPONENTS_COLUMN]: componentsValue,
          [APPLICABLE_COLUMN]: '1',
        });
      } else {
        await table.insertRow({
          [COMPONENTS_COLUMN]: componentsValue,
          [APPLICABLE_COLUMN]: '1',
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Payslip template saved successfully.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
};