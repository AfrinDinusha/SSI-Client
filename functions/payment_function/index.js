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

// Allowed fields for Payment table
const allowedFields = [
  'FromDate', 'ToDate', 'TransactionType', 'GrandTotal', 'GST', 'SGST', 'CGST', 'TDS', 'NetPayable',
  'Organization', 'Contractors', 'Skill', 'SkillType', 'Rateperhour', 'TotalManhours', 'TotalManhoursInDecimal', 'TotalAmount'
];

function cleanDate(value) {
    if (!value || value === '') return null;
    return value;
}

// POST API: Calculate payment details based on attendance data
app.post('/calculate-payment', async (req, res) => {
    // Set a timeout for the entire operation
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('Payment calculation timeout - operation took too long'));
        }, 30000); // 30 second timeout
    });

    const calculationPromise = (async () => {
        try {
            const { contractor, fromDate, toDate, transactionType } = req.body;
            const catalyst = res.locals.catalyst;

            console.log(`Starting payment calculation for contractor: ${contractor}, dates: ${fromDate} to ${toDate}`);

        // Date validation
        const fromDateObj = new Date(fromDate);
        const toDateObj = new Date(toDate);
        
        if (fromDateObj > toDateObj) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'To Date must be after From Date' 
            });
        }
        
        const oneMonthLater = new Date(fromDateObj);
        oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
        if (toDateObj > oneMonthLater) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'The date period should be within 1 month' 
            });
        }
        
        // Additional validation to prevent timeout
        const daysDiff = Math.ceil((toDateObj - fromDateObj) / (1000 * 60 * 60 * 24));
        if (daysDiff > 15) {
            return res.status(400).send({ 
                status: 'failure', 
                message: 'Date range cannot exceed 15 days to prevent timeout. Please select a smaller date range.' 
            });
        }

        // Get tables
        const employeeTable = catalyst.datastore().table('Employee');
        const zcql = catalyst.zcql();

        // Get employees for the specific contractor using ZCQL for better performance
        const contractorQuery = `
            SELECT EmployeeCode, EmployeeName, ContractorName, Skills, SkillsType, RatePerHour, ROWID
            FROM Employee 
            WHERE ContractorName = '${contractor}'
            LIMIT 1000
        `;
        
        console.log('Executing contractor employee query:', contractorQuery);
        const contractorResults = await zcql.executeZCQLQuery(contractorQuery);
        const contractorEmployees = contractorResults.map(r => r.Employee);

        console.log(`Found ${contractorEmployees.length} employees for contractor: ${contractor}`);
        console.log('Contractor employees:', contractorEmployees.map(emp => ({
            EmployeeCode: emp.EmployeeCode,
            EmployeeName: emp.EmployeeName,
            ContractorName: emp.ContractorName,
            Skills: emp.Skills,
            SkillsType: emp.SkillsType,
            RatePerHour: emp.RatePerHour
        })));

        // If no employees found for this contractor, return error
        if (contractorEmployees.length === 0) {
            return res.status(400).send({
                status: 'failure',
                message: `No employees found for contractor: ${contractor}. Please ensure employees are assigned to this contractor.`
            });
        }

        // Get attendance data for the date range using ZCQL
        
        // Get employee codes for the selected contractor
        const contractorEmployeeCodes = contractorEmployees.map(emp => emp.EmployeeCode).filter(code => code);
        const contractorEmployeeIDs = contractorEmployees.map(emp => emp.ROWID).filter(id => id);
        
        console.log('Contractor employee codes:', contractorEmployeeCodes);
        console.log('Contractor employee IDs:', contractorEmployeeIDs);
        
        // Build attendance query to only get attendance for employees of this contractor
        let attendanceQuery;
        if (contractorEmployeeCodes.length > 0) {
            const employeeCodesList = contractorEmployeeCodes.map(code => `'${code}'`).join(',');
            attendanceQuery = `
                SELECT EmployeeID, EventTime, DeviceSerial, Direction 
                FROM BHR 
                WHERE EventTime >= '${fromDate} 00:00:00' 
                AND EventTime <= '${toDate} 23:59:59'
                AND EmployeeID IN (${employeeCodesList})
                AND DeviceSerial IN ('QJT3253600159', 'QJT3253600233')
                ORDER BY EmployeeID, EventTime
                LIMIT 5000
            `;
        } else {
            // Fallback: if no employee codes, get all attendance and filter later
            attendanceQuery = `
                SELECT EmployeeID, EventTime, DeviceSerial, Direction 
                FROM BHR 
                WHERE EventTime >= '${fromDate} 00:00:00' 
                AND EventTime <= '${toDate} 23:59:59'
                AND DeviceSerial IN ('QJT3253600159', 'QJT3253600233')
                ORDER BY EmployeeID, EventTime
                LIMIT 5000
            `;
        }
        
        console.log('Executing attendance query:', attendanceQuery);
        
        const attendanceResults = await zcql.executeZCQLQuery(attendanceQuery);
        let allAttendance = attendanceResults.map(r => r.BHR);

        // If we didn't filter by employee codes in the query, filter the results now
        if (contractorEmployeeCodes.length > 0) {
            allAttendance = allAttendance.filter(record => 
                contractorEmployeeCodes.includes(record.EmployeeID) || 
                contractorEmployeeIDs.includes(record.EmployeeID)
            );
        }

        console.log(`Found ${allAttendance.length} attendance records for contractor ${contractor} in date range ${fromDate} to ${toDate}`);
        
        // If no attendance data found, let's check what dates are available
        if (allAttendance.length === 0) {
            console.log(`No attendance data found for contractor ${contractor} in the specified date range`);
            
            // Check what dates are available in BHR table for this contractor's employees
            if (contractorEmployeeCodes.length > 0) {
                const employeeCodesList = contractorEmployeeCodes.map(code => `'${code}'`).join(',');
                const availableDatesQuery = `
                    SELECT DISTINCT SUBSTRING(EventTime, 1, 10) as DateOnly 
                    FROM BHR 
                    WHERE EmployeeID IN (${employeeCodesList})
                    ORDER BY DateOnly DESC 
                    LIMIT 10
                `;
                
                try {
                    const availableDates = await zcql.executeZCQLQuery(availableDatesQuery);
                    console.log('Available dates for contractor employees in BHR table:', availableDates.map(r => r.BHR.DateOnly));
                } catch (err) {
                    console.log('Error checking available dates:', err.message);
                }
            }
        }

        // Two ESSL devices; both used for IN and OUT — use Direction when set, else min/max (legacy rows)
        const ATTENDANCE_DEVICES = ['QJT3253600159', 'QJT3253600233'];

        const attendanceSummary = {};
        allAttendance.forEach(record => {
            if (!ATTENDANCE_DEVICES.includes(record.DeviceSerial)) return;

            const date = record.EventTime.split(' ')[0];
            const key = `${record.EmployeeID}_${date}`;

            if (!attendanceSummary[key]) {
                attendanceSummary[key] = {
                    EmployeeID: record.EmployeeID,
                    Date: date,
                    FirstIN: '',
                    LastOUT: '',
                    TotalHours: 0,
                    OvertimeHours: 0,
                    Status: ''
                };
            }

            const dir = (record.Direction || '').toLowerCase();
            if (dir === 'in') {
                if (!attendanceSummary[key].FirstIN || record.EventTime < attendanceSummary[key].FirstIN) {
                    attendanceSummary[key].FirstIN = record.EventTime;
                }
            } else if (dir === 'out') {
                if (!attendanceSummary[key].LastOUT || record.EventTime > attendanceSummary[key].LastOUT) {
                    attendanceSummary[key].LastOUT = record.EventTime;
                }
            } else {
                if (!attendanceSummary[key].FirstIN || record.EventTime < attendanceSummary[key].FirstIN) {
                    attendanceSummary[key].FirstIN = record.EventTime;
                }
                if (!attendanceSummary[key].LastOUT || record.EventTime > attendanceSummary[key].LastOUT) {
                    attendanceSummary[key].LastOUT = record.EventTime;
                }
            }
        });

        console.log(`Processed attendance summary for ${Object.keys(attendanceSummary).length} employee-days`);

        // Calculate total hours, overtime, and status for each employee-day
        Object.values(attendanceSummary).forEach(att => {
            if (att.FirstIN && att.LastOUT) {
                att.TotalHours = calculateTotalHours(att.FirstIN, att.LastOUT);
                att.OvertimeHours = calculateOvertimeHours(att.TotalHours);
                att.Status = determineStatus(att.TotalHours);
            } else {
                att.Status = 'Absent';
            }
        });

        // Helper function to calculate total hours from FirstIN and LastOUT
        function calculateTotalHours(firstIN, lastOUT) {
            if (!firstIN || !lastOUT) return 0;
            
            const firstInTime = new Date(firstIN);
            const lastOutTime = new Date(lastOUT);
            
            // If LastOUT is before FirstIN, return 0 (invalid data)
            if (lastOutTime <= firstInTime) return 0;
            
            const diffMs = lastOutTime - firstInTime;
            const diffHours = diffMs / (1000 * 60 * 60);
            
            // Round to 2 decimal places for consistency
            return Math.max(0, Math.round(diffHours * 100) / 100);
        }

        // Helper function to calculate overtime hours (hours beyond 8 hours)
        function calculateOvertimeHours(totalHours) {
            const standardHours = 8;
            return Math.max(0, totalHours - standardHours);
        }

        // Helper function to determine attendance status
        function determineStatus(totalHours) {
            if (totalHours === 0) return 'Absent';
            if (totalHours < 4) return 'Half Day Present';
            if (totalHours >= 4) return 'Present';
            return 'Present';
        }

        // Helper function to format hours to HH:MM
        function formatHoursToTime(decimalHours) {
            if (!decimalHours || decimalHours === 0) return '00:00';
            
            const hours = Math.floor(decimalHours);
            const minutes = Math.round((decimalHours - hours) * 60);
            
            const formattedHours = hours.toString().padStart(2, '0');
            const formattedMinutes = minutes.toString().padStart(2, '0');
            
            return `${formattedHours}:${formattedMinutes}`;
        }

        // Skill type list
        const skillTypeList = ['Skilled', 'Semi-Skilled', 'Un-Skilled'];

        // Get unique skills from contractor's employees
        const skillsList = [...new Set(contractorEmployees
            .filter(emp => emp.Skills)
            .map(emp => emp.Skills))].sort();

        console.log('Available skills for contractor:', skillsList);
        console.log('Total contractor employees:', contractorEmployees.length);
        console.log('Contractor employees with skills:', contractorEmployees.filter(emp => emp.Skills).length);

        // If no skills found, return error
        if (skillsList.length === 0) {
            return res.status(400).send({
                status: 'failure',
                message: `No skills found for contractor: ${contractor}. Please ensure employees have skills assigned.`
            });
        }

        let paymentDetails = [];
        let finalTotalAmount = 0;
        let count = 0;

        // Process each skill and skill type combination
        for (const skill of skillsList) {
            // Filter employees with this skill regardless of skill type
            const skillEmployees = contractorEmployees.filter(emp => emp.Skills === skill);

            if (skillEmployees.length === 0) continue;

            // Get unique skill types for this skill
            const skillTypesForSkill = [...new Set(skillEmployees.map(emp => emp.SkillsType))];

            for (const skillType of skillTypesForSkill) {
                // Get employees with this skill and skill type
                const skillTypeEmployees = skillEmployees.filter(emp => emp.SkillsType === skillType);

                if (skillTypeEmployees.length === 0) continue;

                // Get rate per hour from the first employee with this skill/skill type
                const ratePerHour = parseFloat(skillTypeEmployees[0].RatePerHour) || 0;

                // Calculate total hours from attendance for these employees
                let totalHours = 0;
                let totalOvertimeHours = 0;
                let attendanceDetails = [];

                for (const emp of skillTypeEmployees) {
                    // Find attendance records for this employee using EmployeeCode
                    const empAttendance = Object.values(attendanceSummary).filter(att =>
                        String(att.EmployeeID) === String(emp.EmployeeCode)
                    );

                    console.log(`Employee ${emp.EmployeeCode} (${emp.EmployeeName || 'Unknown'}) has ${empAttendance.length} attendance records`);

                    // If no attendance found by EmployeeCode, try EmployeeID
                    if (empAttendance.length === 0 && emp.EmployeeID) {
                        const empAttendanceByID = Object.values(attendanceSummary).filter(att =>
                            String(att.EmployeeID) === String(emp.EmployeeID)
                        );
                        console.log(`Employee ${emp.EmployeeID} has ${empAttendanceByID.length} attendance records by EmployeeID`);

                        for (const att of empAttendanceByID) {
                            totalHours += att.TotalHours || 0;
                            totalOvertimeHours += att.OvertimeHours || 0;

                            attendanceDetails.push({
                                EmployeeID: emp.EmployeeID,
                                Date: att.Date,
                                TotalHours: att.TotalHours,
                                Status: att.Status,
                                FirstIN: att.FirstIN,
                                LastOUT: att.LastOUT
                            });
                        }
                    } else {
                        for (const att of empAttendance) {
                            totalHours += att.TotalHours || 0;
                            totalOvertimeHours += att.OvertimeHours || 0;

                            // Store attendance details for debugging
                            attendanceDetails.push({
                                EmployeeID: emp.EmployeeCode,
                                Date: att.Date,
                                TotalHours: att.TotalHours,
                                Status: att.Status,
                                FirstIN: att.FirstIN,
                                LastOUT: att.LastOUT
                            });
                        }
                    }
                }

                console.log(`Attendance details for ${skill}/${skillType}:`, attendanceDetails);

                console.log(`Skill: ${skill}, Type: ${skillType}, Employees: ${skillTypeEmployees.length}, Total Hours: ${totalHours}, Overtime: ${totalOvertimeHours}`);

                // Round to 2 decimal places
                const finalTotalHours = totalHours > 0 ? Math.round(totalHours * 100) / 100 : null;

                // Format hours to HH:MM
                const totalHoursFormatted = finalTotalHours ? formatHoursToTime(finalTotalHours) : null;

                // Calculate total amount
                let totalAmount = 0;
                if (finalTotalHours && ratePerHour) {
                    totalAmount = Math.round(ratePerHour * finalTotalHours);
                    finalTotalAmount += totalAmount;
                }

                count++;
                paymentDetails.push({
                    S_No: count,
                    Skill: skill,
                    Skill_Type: skillType,
                    Rate_per_hour: ratePerHour,
                    Total: totalHoursFormatted,
                    Total_Man_hours_In_Decimal: finalTotalHours,
                    Total_Amount: totalAmount
                });
            }
        }

        // If no payment details were generated, return error
        if (paymentDetails.length === 0) {
            return res.status(400).send({
                status: 'failure',
                message: `No payment details could be generated for contractor: ${contractor}. Please ensure employees have attendance records for the selected date range.`
            });
        }

        // Check if all payment details have 0 hours
        const allZeroHours = paymentDetails.every(detail => 
            !detail.Total_Man_hours_In_Decimal || detail.Total_Man_hours_In_Decimal === 0
        );

        if (allZeroHours && paymentDetails.length > 0) {
            return res.status(400).send({
                status: 'failure',
                message: `No attendance hours found for contractor: ${contractor} in the selected date range. Please ensure employees have clocked in/out during this period.`
            });
        }

        // Calculate taxes and net payable
        let netAmount = finalTotalAmount;
        let igst = 0, sgst = 0, cgst = 0, tds = 0, netPayable = 0;

        if (finalTotalAmount > 0) {
            netAmount = finalTotalAmount;
            
            if (transactionType === 'intra-state') {
                sgst = Math.round(finalTotalAmount * 0.09);
                cgst = Math.round(finalTotalAmount * 0.09);
                netAmount += sgst + cgst;
                igst = 0; // Ensure IGST is 0 for intra-state
            } else if (transactionType === 'inter-state') {
                igst = Math.round(finalTotalAmount * 0.18);
                netAmount += igst;
                sgst = 0; // Ensure SGST and CGST are 0 for inter-state
                cgst = 0;
            }
            
            tds = Math.round(finalTotalAmount * 0.02);
            netAmount -= tds;
            netPayable = netAmount;
        }

        console.log('Tax calculation:', {
            transactionType,
            finalTotalAmount,
            igst,
            sgst,
            cgst,
            tds,
            netPayable
        });

        const totals = {
            grandTotal: finalTotalAmount.toString(),
            igst: igst.toString(),
            sgst: sgst.toString(),
            cgst: cgst.toString(),
            tds: tds.toString(),
            netPayable: netPayable.toString()
        };

            return res.status(200).send({
                status: 'success',
                data: {
                    paymentDetails,
                    totals
                }
            });

        } catch (err) {
            console.error('Calculate payment error:', err);
            return res.status(500).send({
                status: 'failure',
                message: err.message || "Error calculating payment details"
            });
        }
    })();

    // Race between calculation and timeout
    try {
        await Promise.race([calculationPromise, timeoutPromise]);
    } catch (err) {
        console.error('Payment calculation failed:', err);
        if (!res.headersSent) {
            res.status(408).send({
                status: 'failure',
                message: err.message || "Payment calculation timeout - please try with a smaller date range"
            });
        }
    }
});

// GET API: Get all payments (with optional pagination)
app.get('/payments', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        
        console.log(`Fetching payments - page: ${page}, perPage: ${perPage}`);
        
        // Try to get the Payment table
        let table;
        try {
            table = catalyst.datastore().table('Payment');
            console.log('Payment table accessed successfully');
        } catch (tableError) {
            console.error('Payment table not found:', tableError);
            return res.status(500).send({ 
                status: 'failure', 
                message: 'Payment table does not exist. Please create the Payment table in your Catalyst datastore with the required columns.' 
            });
        }

        const allRows = await table.getAllRows();
        console.log(`Retrieved ${allRows.length} payment records from database`);
        
        const total = allRows.length;
        const payments = allRows
            .slice((page - 1) * perPage, page * perPage)
            .map(row => ({
                id: row.ROWID,
                ...row
            }));

        console.log(`Returning ${payments.length} payments for page ${page}`);

        res.status(200).send({
            status: 'success',
            data: {
                payments,
                hasMore: page * perPage < total
            }
        });
    } catch (err) {
        console.error('GET /payments error:', err);
        console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        
        // Provide more specific error messages
        let errorMessage = "We're unable to process the request.";
        if (err.message && err.message.includes('table')) {
            errorMessage = 'Payment table does not exist. Please create the Payment table in your Catalyst datastore.';
        } else if (err.message && err.message.includes('permission')) {
            errorMessage = 'Permission denied. Please check your Catalyst datastore permissions.';
        } else if (err.message) {
            errorMessage = `Database error: ${err.message}`;
        }
        
        res.status(500).send({
            status: 'failure',
            message: errorMessage
        });
    }
});

// POST API: Add a new payment
app.post('/payments', async (req, res) => {
  try {
    const body = req.body;
    const { catalyst } = res.locals;
    const fromDate = new Date(body.FromDate);
    const toDate = new Date(body.ToDate);

    // 1. Date validation
    if (body.ToDate && body.FromDate) {
      if (fromDate > toDate) {
        return res.status(400).send({ status: 'failure', message: 'To Date must be after From Date' });
      }
      const oneMonthLater = new Date(fromDate);
      oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
      if (toDate > oneMonthLater) {
        return res.status(400).send({ status: 'failure', message: 'The date period should be within 1 month' });
      }
    }

    // Try to get the Payment table
    let table;
    try {
      table = catalyst.datastore().table('Payment');
    } catch (tableError) {
      console.error('Payment table not found:', tableError);
      return res.status(500).send({ 
        status: 'failure', 
        message: 'Payment table does not exist. Please create the Payment table in your Catalyst datastore with the required columns.' 
      });
    }

    // Prepare payload with exact column names from the Payment table
    const payload = {
      Organization: body.Organization || null,
      Contractors: body.Contractors || null, // Note: plural form as per table structure
      FromDate: cleanDate(body.FromDate),
      ToDate: cleanDate(body.ToDate),
      TransactionType: body.TransactionType || null,
      GrandTotal: body.GrandTotal || '0',
      GST: body.GST || body.IGST || '0', // Use GST if provided, otherwise fallback to IGST
      SGST: body.SGST || '0',
      CGST: body.CGST || '0',
      TDS: body.TDS || '0',
      NetPayable: body.NetPayable || '0',
      Skill: body.PaymentDetails && body.PaymentDetails.length > 0 ? body.PaymentDetails[0].Skill : null // Add Skill field
    };

    console.log('Saving payment with payload:', payload);
    
    // Filter out any undefined or null values that might cause issues
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([key, value]) => value !== undefined && value !== null)
    );
    
    console.log('Clean payload for insertion:', cleanPayload);
    
    const { ROWID: id } = await table.insertRow(cleanPayload);

    res.status(200).send({
      status: 'success',
      data: {
        payment: { id, ...payload }
      }
    });
  } catch (err) {
    console.error('POST /payments error:', err);
    
    // Provide more specific error messages
    if (err.message && err.message.includes('Invalid input value for column name')) {
      res.status(500).send({ 
        status: 'failure', 
        message: 'Payment table column names do not match. Please ensure the Payment table has the following columns: Organization, Contractors, FromDate, ToDate, TransactionType, GrandTotal, GST, SGST, CGST, TDS, NetPayable, Skill' 
      });
    } else {
      res.status(500).send({ 
        status: 'failure', 
        message: err.message || 'Failed to save payment.' 
      });
    }
  }
});

// GET API: Get a payment by ROWID
app.get('/payments/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Payment');
        const row = await table.getRow(ROWID);
        
        if (!row) {
            return res.status(404).send({
                status: 'failure',
                message: 'Payment not found'
            });
        }
        
        res.status(200).send({
            status: 'success',
            data: { payment: row }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: err.message || "Error fetching payment."
        });
  }
});

// PUT API: Update a payment by ROWID
app.put('/payments/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const body = req.body;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Payment');
        const payload = {
            ...Object.fromEntries(Object.entries(body).filter(([key]) => allowedFields.includes(key))),
            FromDate: cleanDate(body.FromDate),
            ToDate: cleanDate(body.ToDate)
        };
        const updatedRow = await table.updateRow({ ROWID, ...payload });
        res.status(200).send({
            status: 'success',
            data: { payment: { id: updatedRow.ROWID, ...payload } }
        });
    } catch (err) {
        console.log(err);
        res.status(400).send({
            status: 'failure',
            message: err.message || "Invalid input provided."
        });
    }
});

// DELETE API: Delete a payment by ROWID
app.delete('/payments/:ROWID', async (req, res) => {
    try {
        const { ROWID } = req.params;
        const { catalyst } = res.locals;
        const table = catalyst.datastore().table('Payment');
        await table.deleteRow(ROWID);
        res.status(200).send({
            status: 'success',
            data: { payment: { id: ROWID } }
        });
    } catch (err) {
        console.log(err);
        res.status(500).send({
            status: 'failure',
            message: "We're unable to process the request."
        });
    }
});

// Debug endpoint to check attendance data for a specific date range
app.get('/debug-attendance', async (req, res) => {
    try {
        const { fromDate, toDate, contractor } = req.query;
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        if (!fromDate || !toDate) {
            return res.status(400).send({
                status: 'failure',
                message: 'fromDate and toDate parameters are required'
            });
        }

        // Get all employees first
        const employeeTable = catalyst.datastore().table('Employee');
        const allEmployees = await employeeTable.getAllRows();
        
        // Get attendance data for the date range
        const attendanceQuery = `
            SELECT EmployeeID, EventTime, Direction, DeviceSerial 
            FROM BHR 
            WHERE EventTime >= '${fromDate} 00:00:00' 
            AND EventTime <= '${toDate} 23:59:59'
            ORDER BY EmployeeID, EventTime
        `;
        const attendanceResults = await zcql.executeZCQLQuery(attendanceQuery);
        const allAttendance = attendanceResults.map(r => r.BHR);

        // Process attendance data similar to calculate-payment
        const ATTENDANCE_DEVICES = ['QJT3253600159', 'QJT3253600233'];

        const attendanceSummary = {};
        allAttendance.forEach(record => {
            if (!ATTENDANCE_DEVICES.includes(record.DeviceSerial)) return;

            const date = record.EventTime.split(' ')[0];
            const key = `${record.EmployeeID}_${date}`;

            if (!attendanceSummary[key]) {
                attendanceSummary[key] = {
                    EmployeeID: record.EmployeeID,
                    Date: date,
                    FirstIN: '',
                    LastOUT: '',
                    TotalHours: 0,
                    OvertimeHours: 0,
                    Status: ''
                };
            }

            const dir = (record.Direction || '').toLowerCase();
            if (dir === 'in') {
                if (!attendanceSummary[key].FirstIN || record.EventTime < attendanceSummary[key].FirstIN) {
                    attendanceSummary[key].FirstIN = record.EventTime;
                }
            } else if (dir === 'out') {
                if (!attendanceSummary[key].LastOUT || record.EventTime > attendanceSummary[key].LastOUT) {
                    attendanceSummary[key].LastOUT = record.EventTime;
                }
            } else {
                if (!attendanceSummary[key].FirstIN || record.EventTime < attendanceSummary[key].FirstIN) {
                    attendanceSummary[key].FirstIN = record.EventTime;
                }
                if (!attendanceSummary[key].LastOUT || record.EventTime > attendanceSummary[key].LastOUT) {
                    attendanceSummary[key].LastOUT = record.EventTime;
                }
            }
        });

        // Calculate hours and status
        Object.values(attendanceSummary).forEach(att => {
            if (att.FirstIN && att.LastOUT) {
                const firstInTime = new Date(att.FirstIN);
                const lastOutTime = new Date(att.LastOUT);
                if (lastOutTime > firstInTime) {
                    const diffMs = lastOutTime - firstInTime;
                    att.TotalHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
                    att.OvertimeHours = Math.max(0, att.TotalHours - 8);
                    att.Status = att.TotalHours === 0 ? 'Absent' :
                                att.TotalHours < 4 ? 'Half Day Present' : 'Present';
                }
            } else {
                att.Status = 'Absent';
            }
        });

        // Get skills and match with employees
        const skillsList = [...new Set(allEmployees
            .filter(emp => emp.Skills)
            .map(emp => emp.Skills))].sort();

        const skillTypeList = ['Skilled', 'Semi-Skilled', 'Un-Skilled'];
        const skillAnalysis = [];

        for (const skill of skillsList) {
            for (const skillType of skillTypeList) {
                const skillEmployees = allEmployees.filter(emp => 
                    emp.Skills === skill && emp.SkillsType === skillType
                );

                if (skillEmployees.length > 0) {
                    let totalHours = 0;
                    const employeeDetails = [];

                    for (const emp of skillEmployees) {
                        const empAttendance = Object.values(attendanceSummary).filter(att => 
                            String(att.EmployeeID) === String(emp.EmployeeCode) ||
                            String(att.EmployeeID) === String(emp.EmployeeID)
                        );

                        const empHours = empAttendance.reduce((sum, att) => sum + (att.TotalHours || 0), 0);
                        totalHours += empHours;

                        employeeDetails.push({
                            EmployeeCode: emp.EmployeeCode,
                            EmployeeID: emp.EmployeeID,
                            EmployeeName: emp.EmployeeName,
                            RatePerHour: emp.RatePerHour,
                            AttendanceRecords: empAttendance.length,
                            TotalHours: empHours
                        });
                    }

                    skillAnalysis.push({
                        Skill: skill,
                        SkillType: skillType,
                        EmployeeCount: skillEmployees.length,
                        TotalHours: totalHours,
                        RatePerHour: skillEmployees[0].RatePerHour || 0,
                        TotalAmount: Math.round((skillEmployees[0].RatePerHour || 0) * totalHours),
                        Employees: employeeDetails
                    });
                }
            }
        }

        res.status(200).send({
            status: 'success',
            data: {
                dateRange: { fromDate, toDate },
                totalRecords: allAttendance.length,
                summaryRecords: Object.keys(attendanceSummary).length,
                availableSkills: skillsList,
                skillAnalysis: skillAnalysis,
                attendanceSummary: Object.values(attendanceSummary).slice(0, 20),
                sampleRawData: allAttendance.slice(0, 10),
                employeeCount: allEmployees.length,
                employeesWithSkills: allEmployees.filter(emp => emp.Skills).length
            }
        });
    } catch (err) {
        console.error('Debug attendance error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || "Error fetching attendance debug data"
        });
    }
});

// Debug endpoint to check contractor-employee relationships
app.get('/debug-contractor-employees', async (req, res) => {
    try {
        const { contractor } = req.query;
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        if (!contractor) {
            return res.status(400).send({
                status: 'failure',
                message: 'contractor parameter is required'
            });
        }

        // Get all employees with contractor information
        const allEmployees = await zcql.executeZCQLQuery(`
            SELECT EmployeeCode, EmployeeName, ContractorName, Skills, SkillsType, RatePerHour 
            FROM Employee 
            ORDER BY ContractorName, EmployeeName
        `);

        const employees = allEmployees.map(r => r.Employee);
        
        // Filter employees by contractor
        const contractorEmployees = employees.filter(emp => 
            emp.ContractorName && emp.ContractorName.toString().toLowerCase() === contractor.toString().toLowerCase()
        );

        // Get unique contractors
        const contractors = [...new Set(employees
            .filter(emp => emp.ContractorName)
            .map(emp => emp.ContractorName))].sort();

        // Get attendance data for contractor employees
        let attendanceData = [];
        if (contractorEmployees.length > 0) {
            const employeeCodes = contractorEmployees.map(emp => emp.EmployeeCode).filter(code => code);
            if (employeeCodes.length > 0) {
                const employeeCodesList = employeeCodes.map(code => `'${code}'`).join(',');
                const attendanceQuery = `
                    SELECT EmployeeID, EventTime, Direction, DeviceSerial 
                    FROM BHR 
                    WHERE EmployeeID IN (${employeeCodesList})
                    ORDER BY EmployeeID, EventTime DESC 
                    LIMIT 20
                `;
                
                try {
                    const attendanceResults = await zcql.executeZCQLQuery(attendanceQuery);
                    attendanceData = attendanceResults.map(r => r.BHR);
                } catch (err) {
                    console.log('Error fetching attendance data:', err.message);
                }
            }
        }

        res.status(200).send({
            status: 'success',
            data: {
                requestedContractor: contractor,
                allContractors: contractors,
                totalEmployees: employees.length,
                contractorEmployees: contractorEmployees,
                contractorEmployeeCount: contractorEmployees.length,
                attendanceRecords: attendanceData.length,
                sampleAttendance: attendanceData.slice(0, 10)
            }
        });
    } catch (err) {
        console.error('Debug contractor-employees error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || "Error fetching contractor-employee data"
        });
    }
});

// Debug endpoint to check system data
app.get('/debug-data', async (req, res) => {
    try {
        const { catalyst } = res.locals;
        const zcql = catalyst.zcql();

        // Check Employee table
        const employeeCount = await zcql.executeZCQLQuery('SELECT COUNT(ROWID) as count FROM Employee');
        const totalEmployees = parseInt(employeeCount[0].Employee.count);

        // Get sample employees with Skills, SkillsType, RatePerHour
        const sampleEmployees = await zcql.executeZCQLQuery(`
            SELECT EmployeeCode, EmployeeName, Skills, SkillsType, RatePerHour 
            FROM Employee 
            WHERE Skills IS NOT NULL OR SkillsType IS NOT NULL OR RatePerHour IS NOT NULL
            LIMIT 5
        `);

        // Check BHR table
        const bhrCount = await zcql.executeZCQLQuery('SELECT COUNT(ROWID) as count FROM BHR');
        const totalBHR = parseInt(bhrCount[0].BHR.count);

        // Get sample BHR records
        const sampleBHR = await zcql.executeZCQLQuery(`
            SELECT EmployeeID, EventTime, Direction, DeviceSerial 
            FROM BHR 
            ORDER BY EventTime DESC 
            LIMIT 5
        `);

        // Check Payment table
        let paymentData = null;
        try {
            const paymentCount = await zcql.executeZCQLQuery('SELECT COUNT(ROWID) as count FROM Payment');
            const totalPayments = parseInt(paymentCount[0].Payment.count);
            
            const samplePayments = await zcql.executeZCQLQuery(`
                SELECT Organization, Contractors, FromDate, ToDate, GrandTotal 
                FROM Payment 
                ORDER BY ROWID DESC 
                LIMIT 5
            `);
            
            paymentData = {
                total: totalPayments,
                sample: samplePayments.map(r => r.Payment)
            };
        } catch (paymentError) {
            paymentData = {
                error: paymentError.message,
                exists: false
            };
        }

        res.status(200).send({
            status: 'success',
            data: {
                employees: {
                    total: totalEmployees,
                    sample: sampleEmployees.map(r => r.Employee)
                },
                bhr: {
                    total: totalBHR,
                    sample: sampleBHR.map(r => r.BHR)
                },
                payment: paymentData
            }
        });
    } catch (err) {
        console.error('Debug data error:', err);
        res.status(500).send({
            status: 'failure',
            message: err.message || "Error fetching debug data"
        });
    }
});

module.exports = app;
