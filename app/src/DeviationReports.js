import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { getDeviationStatus } from './shiftUtils';

function extractTime(dateTimeStr) {
  if (!dateTimeStr) return '-';
  // If already just a time, return as is
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(dateTimeStr)) return dateTimeStr;
  // Otherwise, split by space and return the time part
  const parts = dateTimeStr.split(' ');
  return parts.length > 1 ? parts[1] : dateTimeStr;
}

function isBetweenTimes(timeStr, start, end, bufferMinutes = 0) {
  // timeStr, start, end: 'HH:MM:SS' or 'HH:MM'
  if (!timeStr) return false;
  const [h, m] = timeStr.split(':').map(Number);
  const t = h * 60 + m;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let st = sh * 60 + sm - bufferMinutes;
  let et = eh * 60 + em + bufferMinutes;
  // Clamp to 0-1439 (minutes in a day)
  st = Math.max(0, st);
  et = Math.min(1439, et);
  return t >= st && t <= et;
}

const DeviationReport = () => {
  const [shiftmaps, setShiftmaps] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      axios.get('/server/Shiftmap_function/shiftmaps'),
      axios.get('/server/cms_function/employees'),
      axios.get('/server/Shift_function/shifts')
    ])
      .then(([shiftmapRes, empRes, shiftRes]) => {
        setShiftmaps(shiftmapRes.data.data.shiftmaps || []);
        setEmployees(empRes.data.data.employees || []);
        setShifts(shiftRes.data.data.shifts || []);
        setFetchError('');
      })
      .catch(() => setFetchError('Failed to fetch data.'))
      .finally(() => setLoading(false));
  }, []);

  // Fetch attendance summary for the date range of all shiftmaps
  useEffect(() => {
    if (shiftmaps.length === 0) return;
    const dates = shiftmaps.flatMap(sm => [sm.fromdate, sm.todate]);
    const minDate = dates.reduce((a, b) => a < b ? a : b);
    const maxDate = dates.reduce((a, b) => a > b ? a : b);
    axios.get(`/server/GetAttendanceList?summary=true&startDate=${minDate}&endDate=${maxDate}`)
      .then(res => {
        setAttendanceSummary(res.data.data || []);
      })
      .catch(() => setFetchError('Failed to fetch attendance summary.'));
  }, [shiftmaps]);

  // Helper: get Employee Name by id
  const getEmployeeName = (id) => {
    const emp = employees.find(e => String(e.id) === String(id));
    return emp ? (emp.employeeName || emp.name || '') : '';
  };

  // Helper: get Department by employee id
  const getEmployeeDepartment = (id) => {
    const emp = employees.find(e => String(e.id) === String(id));
    return emp ? (emp.department || emp.Department || '') : '';
  };

  // Helper: get Contractor by employee id
  const getEmployeeContractor = (id) => {
    const emp = employees.find(e => String(e.id) === String(id));
    return emp ? (emp.contractor || emp.ContractorName || '') : '';
  };

  // Helper: get Shift Name by id
  const getShiftName = (id) => {
    const shift = shifts.find(s => s.id === id);
    return shift ? shift.shiftName : id;
  };

  // Helper: get Assigned Shift
  const getAssignedShift = (sm) => sm.assignedShift || '-';

  // Helper: get Employee Code by id
  const getEmployeeCode = (id) => {
    const emp = employees.find(e => String(e.id) === String(id));
    return emp ? emp.employeeCode : id;
  };

  // For each shiftmap, get the First In and Last Out time from attendanceSummary
  const getFirstInForMapping = (sm) => {
    const emp = employees.find(e => String(e.id) === String(sm.employeeId));
    if (!emp || !emp.employeeCode) return '-';
    const record = attendanceSummary.find(row => String(row.EmployeeID) === String(emp.employeeCode) && row.Date === sm.fromdate);
    return record ? extractTime(record.FirstIN) : '-';
  };

  const getLastOutForMapping = (sm) => {
    const emp = employees.find(e => String(e.id) === String(sm.employeeId));
    if (!emp || !emp.employeeCode) return '-';
    const record = attendanceSummary.find(row => String(row.EmployeeID) === String(emp.employeeCode) && row.Date === sm.fromdate);
    return record ? extractTime(record.LastOUT) : '-';
  };

  // Helper: extract HH:MM from time string
  const getHourMinute = (time) => {
    if (!time) return '';
    const parts = time.split(':');
    return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : time;
  };

  // Helper: check if time is in window (supports overnight windows)
  const isInWindow = (time, start, end) => {
    // Accepts "HH:MM" or "HH:MM:SS"
    if (!time) return false;
    const [h, m] = time.split(":").map(Number);
    const t = h * 60 + m;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (endMins >= startMins) {
      // Normal window
      return t >= startMins && t <= endMins;
    } else {
      // Overnight window (e.g., 17:00 to 05:00)
      return t >= startMins || t <= endMins;
    }
  };

  const A_WINDOW = { start: "08:00", end: "10:00" };
  const B_WINDOW = { start: "17:00", end: "05:00" }; // 5pm to 5am (overnight)

  // Deviation logic: only show deviations, not correct check-ins
  const deviationRows = shiftmaps.map(sm => {
    const assignedShift = (sm.assignedShift || '').trim().toUpperCase();
    const firstIn = getFirstInForMapping(sm);
    const lastOut = getLastOutForMapping(sm);
    const status = getDeviationStatus(assignedShift, firstIn);
    if (!status) return null;
    return {
      id: sm.id,
      employeeId: sm.employeeId,
      date: sm.fromdate,
      assignedShift: sm.assignedShift || '-',
      firstIn,
      lastOut,
      status
    };
  }).filter(Boolean);

  return (
    <div className="container">
      <h2>Deviation Report</h2>
      {fetchError && <div style={{ color: 'red' }}>{fetchError}</div>}
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="department-table">
          <thead>
            <tr>
              <th>Employee Code</th>
              <th>Employee Name</th>
              <th>Department</th>
              <th>Contractor</th>
              <th>Date</th>
              <th>Assigned Shift</th>
              <th>Deviation Status</th>
              <th>First In</th>
              <th>Last Out</th>
            </tr>
          </thead>
          <tbody>
            {deviationRows.length > 0 ? (
              deviationRows.map((row, idx) => (
                <tr key={row.id || idx}>
                  <td>{getEmployeeCode(row.employeeId)}</td>
                  <td>{getEmployeeName(row.employeeId)}</td>
                  <td>{getEmployeeDepartment(row.employeeId)}</td>
                  <td>{getEmployeeContractor(row.employeeId)}</td>
                  <td>{row.date}</td>
                  <td>{row.assignedShift}</td>
                  <td>{row.status}</td>
                  <td>{row.firstIn}</td>
                  <td>{row.lastOut}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="text-center">No report found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default DeviationReport;