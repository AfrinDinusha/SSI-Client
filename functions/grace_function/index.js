'use strict';

const catalyst = require('zcatalyst-sdk-node');
const express = require('express');
const app = express();

app.use(express.json());

// Middleware to initialize Catalyst
app.use((req, res, next) => {
    const catalystApp = catalyst.initialize(req);
    res.locals.catalyst = catalystApp;
    next();
});

// Helper function to parse time string (HH:mm or HH:mm:ss) to minutes
function timeToMinutes(timeStr) {
    if (!timeStr || timeStr === '-') return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
}

// Helper function to format minutes to HH:mm
function minutesToTime(minutes) {
    if (minutes === null || minutes === undefined) return '';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Helper function to extract time from datetime string
function extractTime(datetimeStr) {
    if (!datetimeStr) return null;
    const parts = datetimeStr.split(' ');
    if (parts.length < 2) return null;
    const timePart = parts[1];
    // Return HH:mm:ss if seconds are present, otherwise HH:mm
    // Handle both "HH:mm:ss" and "HH:mm" formats
    if (timePart.length >= 8) {
        return timePart.substring(0, 8); // Return HH:mm:ss
    } else if (timePart.length >= 5) {
        return timePart.substring(0, 5); // Return HH:mm
    }
    return timePart;
}

// Helper function to get HH:mm format from time string (ignoring seconds)
function getTimeWithoutSeconds(timeStr) {
    if (!timeStr) return null;
    // Extract HH:mm from time string (ignore seconds)
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    // Pad hours and minutes with leading zeros to ensure consistent format
    const hours = String(parseInt(parts[0], 10)).padStart(2, '0');
    const minutes = String(parseInt(parts[1], 10)).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Helper function to check if FirstIn matches specific times (8:35, 6:10, 2:10) ignoring seconds
function matchesSpecificTimes(firstInTime) {
    if (!firstInTime) return false;
    const timeWithoutSeconds = getTimeWithoutSeconds(firstInTime);
    if (!timeWithoutSeconds) return false;
    
    // Check if time matches 08:35, 06:10, or 02:10 (ignoring seconds)
    // Handles both "8:35" and "08:35" formats
    const specificTimes = ['08:35', '06:10', '02:10'];
    return specificTimes.includes(timeWithoutSeconds);
}

// Calculate grace period: ONLY if FirstIn matches specific times (8:35, 6:10, 2:10) ignoring seconds
function calculateGracePeriod(firstInTime, standardStartTime = '08:00:00') {
    if (!firstInTime) return null;
    
    // ONLY check if FirstIn matches specific times (8:35, 6:10, 2:10) ignoring seconds
    // If it doesn't match, return null (don't add to grace period report)
    if (!matchesSpecificTimes(firstInTime)) {
        return null;
    }
    
    // If it matches, calculate grace period from standard time
    const firstInMinutes = timeToMinutes(firstInTime);
    const standardMinutes = timeToMinutes(standardStartTime);
    
    if (firstInMinutes === null || standardMinutes === null) return null;
    
    // Calculate difference in minutes from standard time
    const diffMinutes = firstInMinutes - standardMinutes;
    
    return {
        graceMinutes: diffMinutes,
        graceHour: minutesToTime(diffMinutes)
    };
}

// GET API: Get all grace period records
app.get('/grace', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const employeeCode = req.query.employeeCode;
        
        let query = 'SELECT ROWID, EmployeeCode, EmployeeName, FirstIn, GraceMinutes, GraceHour, CREATEDTIME, MODIFIEDTIME FROM Grace';
        const conditions = [];
        
        if (startDate && endDate) {
            // Assuming we store date in CREATEDTIME or need to add a Date field
            // For now, we'll filter by CREATEDTIME
            conditions.push(`CREATEDTIME >= '${startDate} 00:00:00' AND CREATEDTIME <= '${endDate} 23:59:59'`);
        }
        
        if (employeeCode && employeeCode !== 'All') {
            conditions.push(`EmployeeCode = '${employeeCode}'`);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY CREATEDTIME DESC';
        
        const rows = await zcql.executeZCQLQuery(query);
        const graceRecords = rows.map(row => ({
            id: row.Grace.ROWID,
            employeeCode: row.Grace.EmployeeCode || '',
            employeeName: row.Grace.EmployeeName || '',
            firstIn: row.Grace.FirstIn || '',
            graceMinutes: row.Grace.GraceMinutes || '',
            graceHour: row.Grace.GraceHour || '',
            createdTime: row.Grace.CREATEDTIME,
            modifiedTime: row.Grace.MODIFIEDTIME
        }));
        
        res.status(200).send({
            status: 'success',
            data: graceRecords
        });
    } catch (err) {
        console.error('Error fetching grace records:', err);
        res.status(500).send({
            status: 'failure',
            message: "Couldn't fetch grace records.",
            error: err.message
        });
    }
});

// POST API: Calculate and update grace periods for a date range
app.post('/calculate-grace', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const { startDate, endDate } = req.body;
        
        if (!startDate || !endDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'startDate and endDate are required'
            });
        }
        
        const zcql = catalyst.zcql();
        const table = catalyst.datastore().table('Grace');
        
        // Get employee details for name lookup
        const employeesQuery = 'SELECT ROWID, EmployeeCode, EmployeeName FROM Employee';
        const employees = await zcql.executeZCQLQuery(employeesQuery);
        
        // Get attendance data from BHR table for the date range
        console.log('Fetching BHR records from', startDate, 'to', endDate);
        const attendanceQuery = `
            SELECT EmployeeID, EventTime 
            FROM BHR 
            WHERE EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDate} 23:59:59'
            ORDER BY EmployeeID, EventTime
        `;
        const attendanceRecords = await zcql.executeZCQLQuery(attendanceQuery);
        console.log(`Found ${attendanceRecords.length} BHR records`);
        
        // Group attendance by employee code and date to get FirstIn and LastOut
        const attendanceMap = {};
        attendanceRecords.forEach(row => {
            const bhr = row.BHR;
            const empId = bhr.EmployeeID; // This is EmployeeCode from BHR table
            const eventTime = bhr.EventTime;
            const date = eventTime.split(' ')[0];
            const time = extractTime(eventTime);
            
            const key = `${empId}_${date}`;
            if (!attendanceMap[key]) {
                attendanceMap[key] = {
                    employeeCode: empId, // Store as employeeCode
                    date: date,
                    firstIn: time,
                    lastOut: time
                };
            } else {
                // Update firstIn if this is earlier
                if (time && (!attendanceMap[key].firstIn || time < attendanceMap[key].firstIn)) {
                    attendanceMap[key].firstIn = time;
                }
                // Update lastOut if this is later
                if (time && (!attendanceMap[key].lastOut || time > attendanceMap[key].lastOut)) {
                    attendanceMap[key].lastOut = time;
                }
            }
        });
        
        // Create a map of employee codes to employee details (for name lookup)
        const employeeCodeMap = {};
        employees.forEach(row => {
            const emp = row.Employee;
            if (emp.EmployeeCode) {
                employeeCodeMap[emp.EmployeeCode] = {
                    code: emp.EmployeeCode,
                    name: emp.EmployeeName,
                    rowId: emp.ROWID
                };
            }
        });
        
        let processedCount = 0;
        let createdCount = 0;
        let updatedCount = 0;
        
        // Process each attendance record from BHR
        for (const key in attendanceMap) {
            const attendance = attendanceMap[key];
            const employeeCode = attendance.employeeCode;
            const date = attendance.date;
            
            if (!attendance.firstIn) continue;
            
            // Calculate grace period using standard time (08:00:00)
            // Grace is calculated if FirstIn is more than 10 minutes after 08:00:00
            const graceData = calculateGracePeriod(attendance.firstIn);
            
            if (graceData) {
                processedCount++;
                
                // Get employee details
                const emp = employeeCodeMap[employeeCode];
                const empName = emp ? emp.name : employeeCode;
                
                // Check if record already exists
                const existingQuery = `
                    SELECT ROWID FROM Grace 
                    WHERE EmployeeCode = '${employeeCode}' 
                    AND CREATEDTIME >= '${date} 00:00:00' 
                    AND CREATEDTIME <= '${date} 23:59:59'
                `;
                const existing = await zcql.executeZCQLQuery(existingQuery);
                
                const graceRecord = {
                    EmployeeCode: employeeCode,
                    EmployeeName: empName,
                    FirstIn: attendance.firstIn,
                    GraceMinutes: graceData.graceMinutes.toString(),
                    GraceHour: graceData.graceHour
                };
                
                if (existing.length > 0) {
                    // Update existing record
                    await table.updateRow({
                        ROWID: existing[0].Grace.ROWID,
                        ...graceRecord
                    });
                    updatedCount++;
                    console.log(`Updated grace record for ${employeeCode} on ${date}: ${graceData.graceMinutes} minutes`);
                } else {
                    // Create new record
                    await table.insertRow(graceRecord);
                    createdCount++;
                    console.log(`Created grace record for ${employeeCode} on ${date}: ${graceData.graceMinutes} minutes`);
                }
            }
        }
        
        res.status(200).send({
            status: 'success',
            message: `Grace periods calculated successfully. Processed: ${processedCount}, Created: ${createdCount}, Updated: ${updatedCount}`,
            data: {
                processed: processedCount,
                created: createdCount,
                updated: updatedCount
            }
        });
    } catch (err) {
        console.error('Error calculating grace periods:', err);
        res.status(500).send({
            status: 'failure',
            message: "Couldn't calculate grace periods.",
            error: err.message
        });
    }
});

// GET API: Get employee codes for filter
app.get('/employee-codes', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();
        const rows = await zcql.executeZCQLQuery('SELECT DISTINCT EmployeeCode FROM Grace ORDER BY EmployeeCode');
        const employeeCodes = rows.map(row => row.Grace.EmployeeCode).filter(Boolean);
        res.status(200).send({
            status: 'success',
            data: employeeCodes
        });
    } catch (err) {
        console.error('Error fetching employee codes:', err);
        res.status(500).send({
            status: 'failure',
            message: "Couldn't fetch employee codes.",
            error: err.message
        });
    }
});

module.exports = app;
