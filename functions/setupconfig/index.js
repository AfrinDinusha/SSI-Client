'use strict';

const catalystSDK = require('zcatalyst-sdk-node');

const COMPONENTS_TABLE = 'Components';
const memoryFallback = [];
const formulaeFallback = [];
const POSITION_COL = 'Position';

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(payload));
};

/** Catalyst may invoke this function with a pathname that still includes the client /server/... prefix. */
function normalizeSetupPathname(pathname) {
  if (!pathname) return '/';
  let p = pathname.split('?')[0];
  const stripPrefixes = ['/server/setupconfig', '/setupconfig'];
  for (const prefix of stripPrefixes) {
    if (p === prefix) return '/';
    if (p.startsWith(`${prefix}/`)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  return p.startsWith('/') ? p : `/${p}`;
}

const parseBody = async (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    if (!body) return resolve({});
    try {
      resolve(JSON.parse(body));
    } catch (error) {
      resolve({});
    }
  });
  req.on('error', () => resolve({}));
});

const toPositionNumber = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const sortByPosition = (a, b) => {
  const ap = toPositionNumber(a?.position);
  const bp = toPositionNumber(b?.position);
  if (ap == null && bp == null) return 0;
  if (ap == null) return 1;
  if (bp == null) return -1;
  return ap - bp;
};

const sortComponentsForOutput = (a, b) => {
  const ad = isDeductionRow(a);
  const bd = isDeductionRow(b);
  if (ad !== bd) return ad ? 1 : -1;
  const pos = sortByPosition(a, b);
  if (pos !== 0) return pos;
  const an = String(a?.allFields || '').toLowerCase();
  const bn = String(b?.allFields || '').toLowerCase();
  return an.localeCompare(bn);
};

const coerceRowId = (value) => {
  const n = Number(value);
  if (Number.isSafeInteger(n)) return n;
  return String(value);
};

async function listComponents(catalyst) {
  try {
    const table = catalyst.datastore().table(COMPONENTS_TABLE);
    const rows = await table.getAllRows();
    return rows
      .map((row) => ({
        id: row.ROWID,
        allFields: row.AllFields || '',
        type: (row.Type || row.ComponentType || '').toString().trim(),
        deduction: (row.Deduction || '').toString().trim(),
        position: (row[POSITION_COL] ?? '').toString().trim()
      }))
      .filter((row) => row.allFields && row.allFields.trim().length > 0)
      .sort(sortComponentsForOutput);
  } catch (error) {
    return memoryFallback.map((value, index) => ({
      id: `mem_${index}`,
      allFields: value,
      type: '',
      deduction: '',
      position: ''
    }));
  }
}

// Keywords that indicate a component is a deduction (exclude from earnings).
const DEDUCTION_KEYWORDS = [
  'pf', 'esi', 'pt', 'lwf', 'rent', 'advance', 'deduction', 'arrear for pf', 'erpf',
  'total deduction', 'admin', 'edli', 'employer', 'contribution', 'recovery'
];

function isDeductionRow(row) {
  const d = (row?.deduction || '').toString().trim().toLowerCase();
  return d === '1' || d === 'true' || d === 'yes' || d === 'y' || d === 'deduction' || d === 'deduct';
}

function isEarningComponent(row) {
  const name = (row.allFields || '').trim().toLowerCase();
  if (!name) return false;
  // If Deduction column is explicitly set, obey it.
  if (isDeductionRow(row)) return false;
  // If row has explicit type from Payroll Setup, use it.
  const type = (row.type || '').toLowerCase();
  if (type === 'deduction' || type === 'deduct') return false;
  if (type === 'earning' || type === 'earnings') return true;
  // Otherwise treat as earning only if it doesn't look like a deduction.
  const isDeduction = DEDUCTION_KEYWORDS.some((kw) => name.includes(kw));
  return !isDeduction;
}

async function listEarningComponents(catalyst) {
  const all = await listComponents(catalyst);
  return all.filter(isEarningComponent).sort(sortByPosition);
}

async function listDeductionComponents(catalyst) {
  const all = await listComponents(catalyst);
  return all.filter((row) => !isEarningComponent(row)).sort(sortByPosition);
}

async function saveAllComponents(catalyst, components) {
  try {
    const table = catalyst.datastore().table(COMPONENTS_TABLE);
    const existing = await listComponents(catalyst);
    let maxAllFieldsPos = 0;
    let maxDeductionPos = 0;
    for (const row of existing) {
      const n = toPositionNumber(row.position);
      if (n == null) continue;
      if (isDeductionRow(row)) maxDeductionPos = Math.max(maxDeductionPos, n);
      else maxAllFieldsPos = Math.max(maxAllFieldsPos, n);
    }

    for (const item of components) {
      const name = typeof item === 'string' ? item : String(item?.name || item?.allFields || '').trim();
      if (!name) continue;
      const isDeduction = typeof item === 'object' && item
        ? Boolean(item.deduction ?? item.isDeduction ?? item.Deduction)
        : false;
      const position = isDeduction ? String(++maxDeductionPos) : String(++maxAllFieldsPos);
      await table.insertRow({
        AllFields: name,
        Deduction: isDeduction ? 'true' : '',
        [POSITION_COL]: position
      });
    }
  } catch (error) {
    memoryFallback.push(...components);
  }
}

async function updateComponentPositions(catalyst, rowIds, startingFrom = 1) {
  const table = catalyst.datastore().table(COMPONENTS_TABLE);
  let pos = startingFrom;
  for (const id of rowIds) {
    const rowId = coerceRowId(id);
    await table.updateRow({
      ROWID: rowId,
      [POSITION_COL]: String(pos++)
    });
  }
}

async function deleteComponentRow(catalyst, rowId) {
  const table = catalyst.datastore().table(COMPONENTS_TABLE);
  const id = coerceRowId(rowId);
  const row = await table.getRow(id);

  const hasComponentName = String(row?.AllFields || '').trim().length > 0;
  if (!hasComponentName) {
    const err = new Error('Row is not a component.');
    err.code = 'NOT_COMPONENT';
    throw err;
  }

  const isDeduction = isDeductionRow({
    deduction: (row?.Deduction || '').toString()
  });

  await table.deleteRow(id);

  // Re-sequence positions (s.no) for the remaining rows in the same category.
  const remaining = (await listComponents(catalyst))
    .filter((r) => isDeductionRow(r) === isDeduction)
    .sort(sortByPosition);

  await updateComponentPositions(catalyst, remaining.map((r) => r.id), 1);
}

async function listFormulae(catalyst) {
  try {
    const table = catalyst.datastore().table(COMPONENTS_TABLE);
    const rows = await table.getAllRows();
    return rows
      .map((row) => ({
        id: row.ROWID,
        expression: row.Formulas || '',
        variable: ''
      }))
      .filter((row) => row.expression && row.expression.trim().length > 0);
  } catch (error) {
    return formulaeFallback.map((value, index) => ({
      id: `fmem_${index}`,
      expression: value.expression || value,
      variable: value.variable || ''
    }));
  }
}

function buildFinalFormulaExpression(variable, expression) {
  const v = String(variable || '').trim();
  const e = String(expression || '').trim();
  if (!e) return '';
  return v && e.includes('=') ? e : (v ? `${v} = ${e}` : e);
}

async function saveFormula(catalyst, variable, expression) {
  const finalExpression = buildFinalFormulaExpression(variable, expression);
  try {
    const table = catalyst.datastore().table(COMPONENTS_TABLE);
    await table.insertRow({ Formulas: finalExpression });
  } catch (error) {
    formulaeFallback.push({ variable: String(variable || '').trim(), expression: finalExpression });
  }
}

async function updateFormulaRow(catalyst, rowId, variable, expression) {
  const finalExpression = buildFinalFormulaExpression(variable, expression);
  if (!finalExpression) {
    const err = new Error('Formula expression is required.');
    err.code = 'VALIDATION';
    throw err;
  }
  try {
    const table = catalyst.datastore().table(COMPONENTS_TABLE);
    const id = coerceRowId(rowId);
    await table.updateRow({
      ROWID: id,
      Formulas: finalExpression
    });
  } catch (error) {
    const m = /^fmem_(\d+)$/.exec(String(rowId));
    if (m) {
      const idx = Number(m[1]);
      if (Number.isFinite(idx) && idx >= 0 && idx < formulaeFallback.length) {
        formulaeFallback[idx] = {
          variable: String(variable || '').trim(),
          expression: finalExpression
        };
        return finalExpression;
      }
    }
    throw error;
  }
  return finalExpression;
}

async function deleteFormulaRow(catalyst, rowId) {
  const table = catalyst.datastore().table(COMPONENTS_TABLE);
  const id = coerceRowId(rowId);
  await table.deleteRow(id);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end();
      return;
    }

    const catalyst = catalystSDK.initialize(req);
    const fullUrl = new URL(req.url, `http://${(req.headers && req.headers.host) || 'localhost'}`);
    const pathname = normalizeSetupPathname(fullUrl.pathname);

    if (pathname === '/payroll/components' && req.method === 'GET') {
      const components = await listComponents(catalyst);
      return json(res, 200, {
        status: 'success',
        data: { components }
      });
    }

    if (pathname === '/payroll/components/earnings' && req.method === 'GET') {
      const components = await listEarningComponents(catalyst);
      return json(res, 200, {
        status: 'success',
        data: { components }
      });
    }

    if (pathname === '/payroll/components/deductions' && req.method === 'GET') {
      const components = await listDeductionComponents(catalyst);
      return json(res, 200, {
        status: 'success',
        data: { components }
      });
    }

    if (pathname === '/payroll/components/save-all' && req.method === 'POST') {
      const body = await parseBody(req);
      const components = Array.isArray(body.components)
        ? body.components
            .map((c) => {
              if (!c) return null;
              if (typeof c === 'string') return String(c).trim();
              if (typeof c === 'object') {
                const name = String(c.name || c.allFields || '').trim();
                const deduction = Boolean(c.deduction ?? c.isDeduction ?? c.Deduction);
                if (!name) return null;
                return { name, deduction };
              }
              return null;
            })
            .filter(Boolean)
        : [];

      if (components.length === 0) {
        return json(res, 400, {
          status: 'failure',
          message: 'No components provided.'
        });
      }

      await saveAllComponents(catalyst, components);

      return json(res, 200, {
        status: 'success',
        message: 'Components saved to Components.AllFields (+Deduction when provided)'
      });
    }

    if (pathname === '/payroll/components/reorder' && req.method === 'POST') {
      const body = await parseBody(req);
      const listKey = String(body.listKey || '').trim();
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.filter(Boolean) : [];

      if (!listKey || (listKey !== 'AllFields' && listKey !== 'Deduction')) {
        return json(res, 400, { status: 'failure', message: 'listKey must be AllFields or Deduction.' });
      }
      if (orderedIds.length === 0) {
        return json(res, 400, { status: 'failure', message: 'orderedIds is required.' });
      }

      await updateComponentPositions(catalyst, orderedIds, 1);
      return json(res, 200, { status: 'success', message: 'Component order updated.' });
    }

    if (pathname === '/payroll/components/delete' && req.method === 'POST') {
      const body = await parseBody(req);
      const rowId = body.rowId ?? body.id ?? body.ROWID;
      if (rowId == null || String(rowId).trim() === '') {
        return json(res, 400, { status: 'failure', message: 'rowId is required.' });
      }

      await deleteComponentRow(catalyst, rowId);
      return json(res, 200, { status: 'success', message: 'Component deleted.' });
    }

    if (pathname === '/payroll/formulae' && req.method === 'GET') {
      const formulae = await listFormulae(catalyst);
      return json(res, 200, { status: 'success', data: { formulae } });
    }

    if (pathname === '/payroll/formulae/save' && req.method === 'POST') {
      const body = await parseBody(req);
      const variable = String(body.variable || '').trim();
      const expression = String(body.expression || '').trim();
      if (!expression) {
        return json(res, 400, {
          status: 'failure',
          message: 'Formula expression is required.'
        });
      }
      await saveFormula(catalyst, variable, expression);
      return json(res, 200, {
        status: 'success',
        message: 'Formula saved successfully'
      });
    }

    if (pathname === '/payroll/formulae/update' && req.method === 'POST') {
      const body = await parseBody(req);
      const rowId = body.rowId ?? body.id ?? body.ROWID;
      const variable = String(body.variable || '').trim();
      const expression = String(body.expression || '').trim();
      if (rowId == null || String(rowId).trim() === '') {
        return json(res, 400, {
          status: 'failure',
          message: 'Formula id is required.'
        });
      }
      if (!expression) {
        return json(res, 400, {
          status: 'failure',
          message: 'Formula expression is required.'
        });
      }
      const finalExpression = await updateFormulaRow(catalyst, rowId, variable, expression);
      return json(res, 200, {
        status: 'success',
        message: 'Formula updated successfully',
        data: {
          formula: { id: rowId, expression: finalExpression }
        }
      });
    }

    if (pathname === '/payroll/formulae/delete' && req.method === 'POST') {
      const body = await parseBody(req);
      const rowId = body.rowId ?? body.id ?? body.ROWID;
      if (rowId == null || String(rowId).trim() === '') {
        return json(res, 400, { status: 'failure', message: 'Formula id is required.' });
      }
      await deleteFormulaRow(catalyst, rowId);
      return json(res, 200, { status: 'success', message: 'Formula deleted.' });
    }

    return json(res, 404, {
      status: 'failure',
      message: 'Route not found'
    });
  } catch (error) {
    console.error('setupconfig function error:', error);
    return json(res, 500, {
      status: 'failure',
      message: error && error.message ? error.message : 'Internal server error'
    });
  }
};
