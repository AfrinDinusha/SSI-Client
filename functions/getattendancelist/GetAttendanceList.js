'use strict';

const catalyst = require('zcatalyst-sdk-node');

module.exports = async (req, res) => {
    try {
        const catalystApp = catalyst.initialize(req);
        const dataStore = catalystApp.datastore();
        const table = dataStore.table('BHR');
        const url = new URL(req.url, `http://${req.headers.host}`);
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');
        const userEmail = url.searchParams.get('userEmail');
        const userRole = url.searchParams.get('userRole');
        // Read pagination parameters from query string
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const pageSize = parseInt(url.searchParams.get('pageSize') || '200', 10);
        
        console.log('GetAttendanceList request:', { userEmail, userRole, startDate, endDate, page, pageSize });
        console.log('Summary mode requested:', url.searchParams.get('summary') === 'true');
        // Use ZCQL for proper pagination with ordering
        const zcql = catalystApp.zcql();
        const offset = (page - 1) * pageSize;
        let query = 'SELECT EmployeeID, EmployeeName, EventTime, DeviceSerial, ROWID FROM BHR';
        let countQuery = 'SELECT COUNT(ROWID) as total FROM BHR';
        
        // Build WHERE conditions
        let whereConditions = [];
        
        // Date filtering
        if (startDate && endDate) {
            whereConditions.push(`EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDate} 23:59:59'`);
        }
        
        // Contractor filtering for App User role
        if (userRole === 'App User' && userEmail) {
            let contractorName = null;
            
            // Special case for dinushaafrin@gmail.com - hardcode the contractor name
            if (userEmail === "dinushaafrin@gmail.com") {
                contractorName = "Sri Balaji Enterprises";
                console.log(`=== DEBUG: Hardcoded contractor for email ${userEmail}: ${contractorName}`);
            } else if (userEmail === "afrindinusha29@gmail.com") {
                contractorName = "Sriram Enterprises";
                console.log(`=== DEBUG: Hardcoded contractor for email ${userEmail}: ${contractorName}`);
            } else if (userEmail === "afrindinusha@gmail.com") {
                contractorName = "R.P.D Facility Management Services";
                console.log(`Hardcoded contractor for email ${userEmail}: ${contractorName}`);
            } else if (userEmail === "afrinatlin@gmail.com") {
                contractorName = "Samuel Enterprise";
                console.log(`Hardcoded contractor for email ${userEmail}: ${contractorName}`);
            } else {
                // For other App Users, try to find contractor by email
                try {
                    const contractorQuery = await zcql.executeZCQLQuery(
                        `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                    );
                   
                    if (contractorQuery && contractorQuery.length > 0) {
                        contractorName = contractorQuery[0].Contractors.ContractorName;
                        const contractorId = contractorQuery[0].Contractors.ROWID;
                        console.log(`Found contractor for email ${userEmail}: ${contractorName} (ID: ${contractorId})`);
                    } else {
                        console.log(`No contractor found for email: ${userEmail}`);
                        // If no contractor found, return empty result
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ data: [], hasMore: false, totalCount: 0 }));
                        return;
                    }
                } catch (error) {
                    console.error('Error filtering by contractor:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Error filtering attendance by contractor' }));
                    return;
                }
            }
            
            // Filter attendance by contractor name through Employee table
            if (contractorName) {
                try {
                    // First get employee IDs for this contractor
                    const employeeQuery = await zcql.executeZCQLQuery(
                        `SELECT EmployeeID FROM Employee WHERE ContractorName = '${contractorName}'`
                    );
                    
                    if (employeeQuery && employeeQuery.length > 0) {
                        const employeeIds = employeeQuery.map(emp => emp.Employee.EmployeeID);
                        const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
                        whereConditions.push(`EmployeeID IN (${employeeIdList})`);
                        console.log(`=== DEBUG: Filtering attendance for contractor: ${contractorName}, Employee IDs: ${employeeIds.join(', ')}`);
                    } else {
                        console.log(`=== DEBUG: No employees found for contractor: ${contractorName}`);
                        // If no employees found for contractor, return empty result
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ data: [], hasMore: false, totalCount: 0 }));
                        return;
                    }
                } catch (error) {
                    console.error('Error getting employees for contractor:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Error getting employees for contractor' }));
                    return;
                }
            }
        }
        
        // Apply WHERE conditions
        if (whereConditions.length > 0) {
            const whereClause = whereConditions.join(' AND ');
            query += ` WHERE ${whereClause}`;
            countQuery += ` WHERE ${whereClause}`;
            console.log(`=== DEBUG: Final query: ${query}`);
            console.log(`=== DEBUG: Final count query: ${countQuery}`);
        } else {
            console.log(`=== DEBUG: No WHERE conditions applied`);
            console.log(`=== DEBUG: Final query: ${query}`);
            console.log(`=== DEBUG: Final count query: ${countQuery}`);
        }
        query += ` ORDER BY ROWID DESC LIMIT ${pageSize} OFFSET ${offset}`;
        const rawResults = await zcql.executeZCQLQuery(query);
        console.log('Raw ZCQL Results:', JSON.stringify(rawResults, null, 2));
        console.log('Raw ZCQL Results length:', rawResults.length);
        const rows = rawResults.map(r => r.BHR);
        
        // Fetch EmployeeNames from Employee table for all unique EmployeeIDs
        const uniqueEmployeeIDs = [...new Set(rows.map(r => r.EmployeeID).filter(Boolean))];
        const employeeNameMap = {};
        if (uniqueEmployeeIDs.length > 0) {
            try {
                const employeeIDList = uniqueEmployeeIDs.map(id => `'${id}'`).join(',');
                const employeeQuery = `SELECT EmployeeCode, EmployeeName FROM Employee WHERE EmployeeCode IN (${employeeIDList})`;
                const employeeResults = await zcql.executeZCQLQuery(employeeQuery);
                
                employeeResults.forEach(row => {
                    const employeeCode = row.Employee.EmployeeCode;
                    const employeeName = row.Employee.EmployeeName;
                    if (employeeCode && employeeName) {
                        employeeNameMap[employeeCode] = employeeName;
                    }
                });
                
                console.log(`Fetched EmployeeNames for ${Object.keys(employeeNameMap).length} out of ${uniqueEmployeeIDs.length} unique EmployeeIDs`);
            } catch (error) {
                console.warn(`Error fetching employee names: ${error.message}. Continuing without EmployeeNames.`);
            }
        }
        
        // Merge EmployeeNames into rows
        const normalizedRows = rows.map(row => ({
            ...row,
            EmployeeName: row.EmployeeName || employeeNameMap[row.EmployeeID] || ''
        }));
        
        // Get total count for all pages
        const countResult = await zcql.executeZCQLQuery(countQuery);
        console.log('Count Query Result:', JSON.stringify(countResult, null, 2));
        const totalCount = Number(countResult[0].BHR['COUNT(ROWID)'] || 0);
        // Check if more records are available
        const hasMore = rows.length === pageSize;
        // Summary mode: earliest IN and latest OUT per employee per date
        if (url.searchParams.get('summary') === 'true') {
            // ESSL: QJT3253600159 + QJT3253600233 — both devices used for IN and OUT (merged in FetchESSLData)
            // Fetch all records for the date range in batches (ZCQL default limit is 200/300)
            let allRows = [];
            let offset = 0;
            const batchSize = 300; // ZCQL max allowed
            let more = true;
            while (more) {
                let summaryQuery = 'SELECT EmployeeID, EmployeeName, EventTime, DeviceSerial, ROWID FROM BHR';
                
                // Apply the same filtering logic for summary mode
                let summaryWhereConditions = [];
                
                // Date filtering
                if (startDate && endDate) {
                    summaryWhereConditions.push(`EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDate} 23:59:59'`);
                }
                
                // Contractor filtering for App User role (same logic as above)
                if (userRole === 'App User' && userEmail) {
                    let contractorName = null;
                    
                    // Special case for dinushaafrin@gmail.com - hardcode the contractor name
                    if (userEmail === "dinushaafrin@gmail.com") {
                        contractorName = "Sri Balaji Enterprises";
                    } else if (userEmail === "afrindinusha29@gmail.com") {
                        contractorName = "Sriram Enterprises";
                    } else if (userEmail === "afrindinusha@gmail.com") {
                        contractorName = "R.P.D Facility Management Services";
                    } else if (userEmail === "afrinatlin@gmail.com") {
                        contractorName = "Samuel Enterprise";
                    } else {
                        // For other App Users, try to find contractor by email
                        try {
                            const contractorQuery = await zcql.executeZCQLQuery(
                                `SELECT ROWID, ContractorName FROM Contractors WHERE PrimaryEmail = '${userEmail}'`
                            );
                           
                            if (contractorQuery && contractorQuery.length > 0) {
                                contractorName = contractorQuery[0].Contractors.ContractorName;
                            }
                        } catch (error) {
                            console.error('Error filtering by contractor in summary mode:', error);
                        }
                    }
                    
                    // Filter attendance by contractor name through Employee table
                    if (contractorName) {
                        try {
                            // First get employee IDs for this contractor
                            const employeeQuery = await zcql.executeZCQLQuery(
                                `SELECT EmployeeID FROM Employee WHERE ContractorName = '${contractorName}'`
                            );
                            
                            if (employeeQuery && employeeQuery.length > 0) {
                                const employeeIds = employeeQuery.map(emp => emp.Employee.EmployeeID);
                                const employeeIdList = employeeIds.map(id => `'${id}'`).join(',');
                                summaryWhereConditions.push(`EmployeeID IN (${employeeIdList})`);
                            }
                        } catch (error) {
                            console.error('Error getting employees for contractor in summary mode:', error);
                        }
                    }
                }
                
                // Apply WHERE conditions for summary query
                if (summaryWhereConditions.length > 0) {
                    const summaryWhereClause = summaryWhereConditions.join(' AND ');
                    summaryQuery += ` WHERE ${summaryWhereClause}`;
                }
                
                summaryQuery += ` ORDER BY ROWID DESC LIMIT ${batchSize} OFFSET ${offset}`;
                const batchResults = await zcql.executeZCQLQuery(summaryQuery);
                const batchRows = batchResults.map(r => r.BHR);
                allRows = allRows.concat(batchRows);
                if (batchRows.length < batchSize) {
                    more = false;
                } else {
                    offset += batchSize;
                }
            }
            
            // Fetch EmployeeNames from Employee table for all unique EmployeeIDs in summary
            const uniqueSummaryEmployeeIDs = [...new Set(allRows.map(r => r.EmployeeID).filter(Boolean))];
            const summaryEmployeeNameMap = {};
            if (uniqueSummaryEmployeeIDs.length > 0) {
                try {
                    const employeeIDList = uniqueSummaryEmployeeIDs.map(id => `'${id}'`).join(',');
                    const employeeQuery = `SELECT EmployeeCode, EmployeeName FROM Employee WHERE EmployeeCode IN (${employeeIDList})`;
                    const employeeResults = await zcql.executeZCQLQuery(employeeQuery);
                    
                    employeeResults.forEach(row => {
                        const employeeCode = row.Employee.EmployeeCode;
                        const employeeName = row.Employee.EmployeeName;
                        if (employeeCode && employeeName) {
                            summaryEmployeeNameMap[employeeCode] = employeeName;
                        }
                    });
                    
                    console.log(`Fetched EmployeeNames for ${Object.keys(summaryEmployeeNameMap).length} out of ${uniqueSummaryEmployeeIDs.length} unique EmployeeIDs in summary`);
                } catch (error) {
                    console.warn(`Error fetching employee names for summary: ${error.message}. Continuing without EmployeeNames.`);
                }
            }
            
            // Merge EmployeeNames into summary rows
            const normalizedSummaryRows = allRows.map(row => ({
                ...row,
                EmployeeName: row.EmployeeName || summaryEmployeeNameMap[row.EmployeeID] || ''
            }));
            // Debug logging for summary mode
            console.log('SUMMARY DEBUG: Raw records fetched:', normalizedSummaryRows.length);
            console.log('SUMMARY DEBUG: Sample raw records:', normalizedSummaryRows.slice(0, 3));
            // Group and summarize
            const summary = {};
            normalizedSummaryRows.forEach((r, index) => {
                const date = r.EventTime.split(' ')[0];
                const key = `${r.EmployeeID}_${date}`;
                if (!summary[key]) {
                    summary[key] = {
                        EmployeeID: r.EmployeeID,
                        EmployeeName: r.EmployeeName || summaryEmployeeNameMap[r.EmployeeID] || '',
                        Date: date,
                        FirstIN: '',
                        LastOUT: ''
                    };
                }
                // Since Direction field is removed, treat all records as both IN and OUT
                // This means we'll use the earliest time as FirstIN and latest time as LastOUT
                // Process all records regardless of device serial
                // Earliest time as FirstIN
                if (!summary[key].FirstIN || r.EventTime < summary[key].FirstIN) {
                    summary[key].FirstIN = r.EventTime;
                }
                // Latest time as LastOUT
                if (!summary[key].LastOUT || r.EventTime > summary[key].LastOUT) {
                    summary[key].LastOUT = r.EventTime;
                }
                
                // Debug first few records
                if (index < 3) {
                    console.log(`SUMMARY DEBUG: Processing record ${index}:`, {
                        EmployeeID: r.EmployeeID,
                        EventTime: r.EventTime,
                        date,
                        key,
                        currentFirstIN: summary[key].FirstIN,
                        currentLastOUT: summary[key].LastOUT
                    });
                }
            });
            const summaryArr = Object.values(summary);
            console.log('SUMMARY DEBUG: Summary rows created:', summaryArr.length);
            console.log('SUMMARY DEBUG: Unique EmployeeID_Date keys:', Object.keys(summary));
            console.log('SUMMARY DEBUG: Sample summary data:', summaryArr.slice(0, 2));
            
            // For summary mode, we need to calculate hasMore and totalCount
            const hasMore = false; // Summary mode doesn't use pagination
            const totalCount = summaryArr.length;
            
            console.log('SUMMARY DEBUG: Response data:', { 
                dataLength: summaryArr.length, 
                hasMore, 
                totalCount 
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: summaryArr, hasMore, totalCount }));
            return;
        }
        // Send response
        console.log('Regular mode response:', { 
            dataLength: normalizedRows.length, 
            hasMore, 
            totalCount 
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: normalizedRows, hasMore, totalCount }));
    } catch (error) {
        console.error('Error fetching manual attendance list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
};