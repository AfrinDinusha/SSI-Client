'use strict';

const catalystSDK = require('zcatalyst-sdk-node');
const { URL } = require('url');

const TABLE_NAME = 'PermissionReport';
const TABLE_ALIAS = 'PermissionReport';
const PERMISSION_LOH_GRACE_HOURS = 1.5;
const PAYROLL_PAGE_SIZE = 300;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getPath(reqUrl) {
  const pathname = new URL(reqUrl || '/', 'http://localhost').pathname || '/';
  const prefixes = ['/server/permissionreport_function', '/permissionreport_function'];

  for (const prefix of prefixes) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }

  return pathname;
}

function parsePayrollLohHours(raw) {
  const n = parseFloat(String(raw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(2));
}

/** Any positive LOH saved on payroll row (post-grace or legacy raw). */
function qualifiesForPermissionReport(lohStored) {
  return parsePayrollLohHours(lohStored) > 0;
}

function permissionUsedFromPayrollLoh(lohStored) {
  const stored = parsePayrollLohHours(lohStored);
  if (stored <= 0) return '0';
  if (stored < PERMISSION_LOH_GRACE_HOURS) return String(stored);
  return String(PERMISSION_LOH_GRACE_HOURS);
}

function mapPayrollRowToPermissionReport(payrollRow) {
  const p = payrollRow.Payroll || payrollRow || {};
  const loh = p.LOH ?? p.loh;
  if (!qualifiesForPermissionReport(loh)) return null;

  return {
    id: '',
    employeeName: String(p.EmployeeName || '').trim(),
    employeeId: String(p.EmployeeCode || '').trim(),
    permissionApplicable: String(PERMISSION_LOH_GRACE_HOURS),
    permissionUsed: permissionUsedFromPayrollLoh(loh),
    createdTime: null,
    modifiedTime: null,
  };
}

async function resolvePayrollMonth(zcql, monthQuery) {
  const trimmed = String(monthQuery || '').trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  try {
    const rows = await zcql.executeZCQLQuery(
      'SELECT Month_filter FROM Payroll ORDER BY Month_filter DESC LIMIT 1'
    );
    const row = rows?.[0]?.Payroll || rows?.[0] || {};
    return String(row.Month_filter || '').trim() || null;
  } catch (e) {
    console.warn('resolvePayrollMonth failed:', e?.message || e);
    return null;
  }
}

async function fetchAllPayrollRowsForMonth(zcql, month) {
  const monthEsc = String(month).replace(/'/g, "''").trim();
  const all = [];
  let offset = 0;

  while (true) {
    const query = `
      SELECT ROWID, EmployeeName, EmployeeCode, LOH
      FROM Payroll
      WHERE Month_filter = '${monthEsc}'
      ORDER BY ROWID DESC
      LIMIT ${PAYROLL_PAGE_SIZE} OFFSET ${offset}
    `;
    const batch = await zcql.executeZCQLQuery(query);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAYROLL_PAGE_SIZE) break;
    offset += PAYROLL_PAGE_SIZE;
  }

  return all;
}

async function fetchPermissionReportsFromPayroll(catalyst, month) {
  if (!month) return [];
  const zcql = catalyst.zcql();
  const rows = await fetchAllPayrollRowsForMonth(zcql, month);
  const byEmployee = new Map();

  for (const row of rows) {
    const p = row.Payroll || row;
    const empId = String(p.EmployeeCode || '').trim();
    if (!empId) continue;

    const mapped = mapPayrollRowToPermissionReport(p);
    if (!mapped) continue;

    const lohScore = parsePayrollLohHours(p.LOH);
    const existing = byEmployee.get(empId);
    if (!existing || lohScore > existing._lohScore) {
      byEmployee.set(empId, { ...mapped, _lohScore: lohScore });
    }
  }

  return Array.from(byEmployee.values())
    .map(({ _lohScore, ...rest }) => rest)
    .sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
}

module.exports = async (req, res) => {
  try {
    const path = getPath(req.url);
    const urlObj = new URL(req.url || '/', 'http://localhost');

    if (req.method !== 'GET') {
      return sendJson(res, 405, {
        status: 'failure',
        message: 'Method not allowed',
      });
    }

    if (path !== '/' && path !== '/permission-report') {
      return sendJson(res, 404, {
        status: 'failure',
        message: 'Route not found',
      });
    }

    const catalyst = catalystSDK.initialize(req);
    const zcql = catalyst.zcql();
    const month = await resolvePayrollMonth(zcql, urlObj.searchParams.get('month'));
    const permissionReports = await fetchPermissionReportsFromPayroll(catalyst, month);

    return sendJson(res, 200, {
      status: 'success',
      data: {
        permissionReports,
        month: month || null,
      },
    });
  } catch (error) {
    console.error('permissionreport_function error:', error);
    return sendJson(res, 500, {
      status: 'failure',
      message: `Failed to fetch permission report: ${error.message || 'Unknown error'}`,
    });
  }
};
