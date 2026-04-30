'use strict';

const catalyst = require('zcatalyst-sdk-node');
const axios = require('axios');
const xml2js = require('xml2js');

function readPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.floor(n);
    return i > 0 ? i : fallback;
}

function readNonNegativeInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.floor(n);
    return i >= 0 ? i : fallback;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
    const ms = readPositiveInt(timeoutMs, 0);
    if (!ms) return promise;

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || `Timeout after ${ms}ms`)), ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function isRetryableAxiosError(error) {
    if (!error) return false;

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;

    const retryableCodes = new Set(['ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH']);
    if (error.code && retryableCodes.has(error.code)) return true;

    if (error.response && typeof error.response.status === 'number') {
        return error.response.status >= 500;
    }

    return false;
}

function normalizeEsslBaseUrl(baseUrl) {
    if (!baseUrl) return '';
    const trimmed = String(baseUrl).trim();
    if (!trimmed) return '';

    // If it's already the SOAP endpoint, keep as-is.
    if (trimmed.toLowerCase().includes('.asmx')) return trimmed;

    // If user gives a web UI page like .../Main.aspx, strip the page portion.
    try {
        const u = new URL(trimmed);
        let pathname = u.pathname || '';
        if (pathname.toLowerCase().endsWith('.aspx')) {
            const parts = pathname.split('/').filter(Boolean);
            parts.pop();
            pathname = `/${parts.join('/')}`;
        }
        return `${u.origin}${pathname}`.replace(/\/+$/, '');
    } catch {
        return trimmed.replace(/\/[^/]*\.aspx$/i, '').replace(/\/+$/, '');
    }
}

function buildEsslEndpointCandidates(baseUrl) {
    if (!baseUrl) return [];

    const normalized = normalizeEsslBaseUrl(baseUrl);
    if (!normalized) return [];

    // If user already provided a SOAP endpoint, use it as-is.
    if (normalized.toLowerCase().includes('.asmx')) return [normalized];

    const clean = normalized.replace(/\/+$/, '');
    return [
        clean,
        `${clean}/iclock/webapiservice.asmx`,
        `${clean}/iClock/WebAPIService.asmx`,
        `${clean}/WebAPIService.asmx`,
        `${clean}/webapiservice.asmx`
    ];
}

async function resolveEsslEndpoint(candidates, soapBody, options) {
    const probeTimeoutMs = readPositiveInt(options && options.probeTimeoutMs, 12000);

    const failures = [];
    for (const candidate of candidates) {
        try {
            const res = await axios.post(candidate, soapBody, {
                headers: options && options.headers ? options.headers : {},
                timeout: probeTimeoutMs,
                maxRedirects: 5,
                validateStatus: () => true
            });

            if (res && res.status === 200 && typeof res.data === 'string' && res.data.includes('GetTransactionsLogResponse')) {
                console.log(`Resolved ESSL endpoint: ${candidate}`);
                return candidate;
            }

            failures.push({ url: candidate, status: res && res.status });
        } catch (error) {
            failures.push({ url: candidate, error: error.code || error.message });
        }
    }

    const details = failures.slice(0, 5);
    const error = new Error(`Unable to reach ESSL SOAP endpoint. Probed ${candidates.length} URL(s).`);
    error.probeDetails = details;
    throw error;
}

async function postWithRetry(url, body, axiosConfig, options) {
    const maxRetries = readNonNegativeInt(options && options.retries, 0); // number of retries after the first attempt
    const baseDelayMs = readPositiveInt(options && options.baseDelayMs, 500);
    const maxDelayMs = readPositiveInt(options && options.maxDelayMs, 5000);

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
                console.warn(`Retrying ESSL request (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms...`);
                await sleep(delay);
            }
            return await axios.post(url, body, axiosConfig);
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryableAxiosError(error)) {
                throw error;
            }
            console.warn(`ESSL request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`);
        }
    }

    throw lastError;
}

async function fetchAndStoreAttendance(catalystApp, fromDateTimeParam, toDateTimeParam, options = {}) {
    // BuildHr API credentials
    const buildHrCredentials = {
        url: options.url || process.env.ESSL_URL || 'http://www.esslcloud.com/SSINDUST/Main.aspx',
        userName: options.userName || process.env.ESSL_USERNAME || 'SSINDUST',
        userPassword: options.userPassword || process.env.ESSL_PASSWORD || 'SSIndust@2026'
    };
    // Only use ESSL cloud API, remove any previous API logic

    // Default to 90s to reduce ESSL cloud timeouts (override via query/env if needed).
    const requestTimeoutMs = readPositiveInt(options.requestTimeoutMs, readPositiveInt(process.env.ESSL_TIMEOUT_MS, 90000));
    const retryOptions = {
        retries: readNonNegativeInt(options.retries, readNonNegativeInt(process.env.ESSL_RETRIES, 0)),
        baseDelayMs: readPositiveInt(options.baseDelayMs, readPositiveInt(process.env.ESSL_RETRY_BASE_DELAY_MS, 500)),
        maxDelayMs: readPositiveInt(options.maxDelayMs, readPositiveInt(process.env.ESSL_RETRY_MAX_DELAY_MS, 5000))
    };

    // Use custom date range if provided, otherwise use default logic
    let fromDateTime, toDateTime;
    if (fromDateTimeParam && toDateTimeParam) {
        fromDateTime = fromDateTimeParam;
        toDateTime = toDateTimeParam;
    } else {
        fromDateTime = '2025-10-01 00:00';
        toDateTime = '2025-10-17 23:59';
    }

    let totalInsertedCount = 0;
    const table = catalystApp.datastore().table('BHR');

    // Both devices record IN and OUT; punches are merged per employee per day, then earliest = IN, latest = OUT.
    const DEFAULT_SERIALS = ['QJT3253600159', 'QJT3253600233'];
    const serialList = options.serial
        ? [String(options.serial).trim()]
        : DEFAULT_SERIALS;

    // Use exact date range provided, no month expansion
    const monthRanges = [{
        from: fromDateTime,
        to: toDateTime
    }];

    for (const { from, to } of monthRanges) {
        /** @type {Record<string, Array<{ EmployeeID: string, EventTime: string, DeviceSerial: string }>>} */
        const mergedByDay = {};

        for (const serial of serialList) {
            const soapBody = `
                <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                    <soap:Body>
                        <GetTransactionsLog xmlns="http://tempuri.org/">
                            <FromDateTime>${from}</FromDateTime>
                            <ToDateTime>${to}</ToDateTime>
                            <SerialNumber>${serial}</SerialNumber>
                            <UserName>${buildHrCredentials.userName}</UserName>
                            <UserPassword>${buildHrCredentials.userPassword}</UserPassword>
                            <strDataList>123</strDataList>
                        </GetTransactionsLog>
                    </soap:Body>
                </soap:Envelope>
            `;

            try {
                const endpointCandidates = buildEsslEndpointCandidates(buildHrCredentials.url);
                const resolvedEndpoint = await resolveEsslEndpoint(endpointCandidates, soapBody, {
                    probeTimeoutMs: readPositiveInt(options.probeTimeoutMs, Math.min(15000, Math.max(6000, Math.floor(requestTimeoutMs / 10)))),
                    headers: {
                        'Content-Type': 'text/xml; charset=utf-8',
                        'SOAPAction': 'http://tempuri.org/GetTransactionsLog'
                    }
                });

                const response = await postWithRetry(
                    resolvedEndpoint,
                    soapBody,
                    {
                        headers: {
                            'Content-Type': 'text/xml; charset=utf-8',
                            'SOAPAction': 'http://tempuri.org/GetTransactionsLog',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'text/xml, application/xml, */*',
                            'Accept-Encoding': 'gzip, deflate',
                            'Connection': 'keep-alive'
                        },
                        timeout: requestTimeoutMs,
                        maxRedirects: 0,
                        validateStatus: function (status) {
                            return status >= 200 && status < 500;
                        }
                    },
                    retryOptions
                );

                console.log(`API Response Status (${serial}): ${response.status}`);
                console.log(`API Response Data Length (${serial}): ${response.data ? response.data.length : 0}`);

                if (response.status !== 200) {
                    throw new Error(`ESSL server returned status ${response.status}: ${response.statusText}`);
                }

                const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
                const result = await parser.parseStringPromise(response.data);
                const transactionsString = result['soap:Envelope']['soap:Body']['GetTransactionsLogResponse']['strDataList'];

                if (!transactionsString) {
                    console.log(`No attendance data found for device ${serial} for range ${from} to ${to}`);
                    continue;
                }

                const lines = transactionsString.split('\n').map(line => line.trim()).filter(line => line);
                console.log(`Device ${serial}: ${lines.length} transaction lines`);

                for (const line of lines) {
                    const parts = line.split(/\s+/);
                    if (parts.length >= 3) {
                        const EmployeeID = parts[0];
                        const EventTime = parts[1] + ' ' + parts[2];
                        const isValidDateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(EventTime);
                        if (!isValidDateTime) {
                            console.warn(`Skipping invalid EventTime: ${EventTime}`);
                            continue;
                        }
                        const date = EventTime.split(' ')[0];
                        const key = `${EmployeeID}_${date}`;
                        if (!mergedByDay[key]) {
                            mergedByDay[key] = [];
                        }
                        mergedByDay[key].push({ EmployeeID, EventTime, DeviceSerial: serial });
                    } else {
                        console.warn(`Skipping malformed line: ${line}`);
                    }
                }
            } catch (error) {
                const status = error && error.response ? error.response.status : undefined;
                console.error(`Error fetching data from device ${serial} for range ${from} to ${to}:`, {
                    message: error.message,
                    code: error.code,
                    status,
                    requestTimeoutMs
                });
                if (error && error.probeDetails) {
                    console.error('ESSL endpoint probe details:', error.probeDetails);
                }
                if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                    console.error(`Timeout fetching device ${serial} from ${buildHrCredentials.url} (timeout=${requestTimeoutMs}ms)`);
                } else if (error.response) {
                    console.error('Response Data:', error.response.data);
                }
                continue;
            }
        }

        const uniqueEmployeeIDs = new Set();
        Object.values(mergedByDay).forEach(transactions => {
            transactions.forEach(t => uniqueEmployeeIDs.add(t.EmployeeID));
        });

        const employeeNameMap = {};
        if (uniqueEmployeeIDs.size > 0) {
            try {
                const employeeIDList = Array.from(uniqueEmployeeIDs).map(id => `'${id}'`).join(',');
                const employeeQuery = `SELECT EmployeeCode, EmployeeName FROM Employee WHERE EmployeeCode IN (${employeeIDList})`;
                const employeeResults = await catalystApp.zcql().executeZCQLQuery(employeeQuery);

                employeeResults.forEach(row => {
                    const employeeCode = row.Employee.EmployeeCode;
                    const employeeName = row.Employee.EmployeeName;
                    if (employeeCode && employeeName) {
                        employeeNameMap[employeeCode] = employeeName;
                    }
                });

                console.log(`Found EmployeeNames for ${Object.keys(employeeNameMap).length} out of ${uniqueEmployeeIDs.size} unique EmployeeIDs`);
            } catch (error) {
                console.warn(`Error fetching employee names: ${error.message}. Continuing without EmployeeNames.`);
            }
        }

        let insertedCount = 0;
        for (const [, transactions] of Object.entries(mergedByDay)) {
            if (transactions.length === 0) continue;

            transactions.sort((a, b) => new Date(a.EventTime) - new Date(b.EventTime));

            const firstTransaction = transactions[0];
            const lastTransaction = transactions[transactions.length - 1];
            const employeeName = employeeNameMap[firstTransaction.EmployeeID] || '';

            const inSerial = firstTransaction.DeviceSerial;
            const inQuery = `SELECT CREATEDTIME FROM BHR WHERE EmployeeID = '${firstTransaction.EmployeeID}' AND EventTime = '${firstTransaction.EventTime}' AND Direction = 'in' AND DeviceSerial = '${inSerial}'`;
            const inExisting = await catalystApp.zcql().executeZCQLQuery(inQuery);
            if (inExisting.length === 0) {
                await table.insertRow({
                    EmployeeID: firstTransaction.EmployeeID,
                    EmployeeName: employeeName,
                    EventTime: firstTransaction.EventTime,
                    Direction: 'in',
                    DeviceSerial: inSerial
                });
                insertedCount++;
                console.log(`[IN] Inserted check-in: EmployeeID=${firstTransaction.EmployeeID}, EmployeeName=${employeeName}, EventTime=${firstTransaction.EventTime}, Device=${inSerial}`);
            }

            if (firstTransaction.EventTime !== lastTransaction.EventTime) {
                const outSerial = lastTransaction.DeviceSerial;
                const outQuery = `SELECT CREATEDTIME FROM BHR WHERE EmployeeID = '${lastTransaction.EmployeeID}' AND EventTime = '${lastTransaction.EventTime}' AND Direction = 'out' AND DeviceSerial = '${outSerial}'`;
                const outExisting = await catalystApp.zcql().executeZCQLQuery(outQuery);
                if (outExisting.length === 0) {
                    await table.insertRow({
                        EmployeeID: lastTransaction.EmployeeID,
                        EmployeeName: employeeName,
                        EventTime: lastTransaction.EventTime,
                        Direction: 'out',
                        DeviceSerial: outSerial
                    });
                    insertedCount++;
                    console.log(`[OUT] Inserted check-out: EmployeeID=${lastTransaction.EmployeeID}, EmployeeName=${employeeName}, EventTime=${lastTransaction.EventTime}, Device=${outSerial}`);
                }
            }
        }

        console.log(`Merged ${serialList.length} device(s) for ${from} to ${to}: ${insertedCount} records inserted`);
        totalInsertedCount += insertedCount;
    }

    return { message: 'BuildHr data fetched and stored successfully', transaction_count: totalInsertedCount };
}

module.exports = async (req, res) => {
    try {
        const catalystApp = catalyst.initialize(req);
        const dataStore = catalystApp.datastore();
        const table = dataStore.table('BHR');
        const url = new URL(req.url, `http://${req.headers.host}`);
       
        // Handle POST request for fetching ESSL data
        if (req.method === 'POST') {
            const fromDateTime = url.searchParams.get('fromDateTime');
            const toDateTime = url.searchParams.get('toDateTime');
            const testMode = url.searchParams.get('test') === 'true';
            const esslUrl = url.searchParams.get('url') || process.env.ESSL_URL || 'http://www.esslcloud.com/SSINDUST/Main.aspx';
            // Omit serial to pull both default devices (both used for IN and OUT; merged per day).
            const esslSerial = url.searchParams.get('serial');
            const esslUser = url.searchParams.get('user') || process.env.ESSL_USERNAME || 'SSINDUST';
            const esslPassword = url.searchParams.get('password') || process.env.ESSL_PASSWORD || 'SSIndust@2026';
            // Default to 90s to reduce ESSL cloud timeouts (override via query/env if needed).
            const requestTimeoutMs = readPositiveInt(
                url.searchParams.get('requestTimeoutMs') || url.searchParams.get('timeoutMs'),
                readPositiveInt(process.env.ESSL_TIMEOUT_MS, 90000)
            );
            const retries = readNonNegativeInt(url.searchParams.get('retries'), readNonNegativeInt(process.env.ESSL_RETRIES, 0));
            // Ensure wrapper timeout covers all attempts + some buffer.
            const defaultFunctionTimeoutMs = (requestTimeoutMs * (retries + 1)) + 80000;
            const functionTimeoutMs = readPositiveInt(
                url.searchParams.get('functionTimeoutMs'),
                readPositiveInt(process.env.FUNCTION_TIMEOUT_MS, defaultFunctionTimeoutMs)
            );
            
            console.log('FetchESSLData POST request:', { fromDateTime, toDateTime, testMode, requestTimeoutMs, retries, functionTimeoutMs, esslUrl, esslSerial: esslSerial || 'both devices (merged IN/OUT per day)' });
           
            // Test mode - just test connectivity without processing data
            if (testMode) {
                try {
                    console.log('=== CATALYST CONNECTIVITY TEST ===');
                   
                    // Test 1: Basic HTTP connectivity
                    console.log('Test 1: Basic HTTP GET to ESSL server...');
                    const startTime = Date.now();
                    let responseTime = null;
                    try {
                        const testResponse = await axios.get(esslUrl, {
                            timeout: 10000,
                            validateStatus: () => true
                        });
                        responseTime = Date.now() - startTime;
                        console.log(`✅ HTTP GET successful: Status ${testResponse.status}, Time: ${responseTime}ms`);
                    } catch (getError) {
                        responseTime = Date.now() - startTime;
                        console.log(`❌ HTTP GET failed: ${getError.message}, Time: ${responseTime}ms`);
                    }
                   
                    // Test 2: Simple SOAP request
                    console.log('Test 2: Simple SOAP request...');
                    const soapTestBody = `
                        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                            <soap:Body>
                                <GetTransactionsLog xmlns="http://tempuri.org/">
                                    <FromDateTime>2025-10-07 00:00:00</FromDateTime>
                                    <ToDateTime>2025-10-07 23:59:59</ToDateTime>
                                    <SerialNumber>QJT3253600159</SerialNumber>
                                    <UserName>SSINDUST</UserName>
                                    <UserPassword>SSIndust@2026</UserPassword>
                                    <strDataList>123</strDataList>
                                </GetTransactionsLog>
                            </soap:Body>
                        </soap:Envelope>
                    `;
                   
                    const soapStartTime = Date.now();
                    try {
                        const soapResponse = await postWithRetry(
                            esslUrl,
                            soapTestBody,
                            {
                                headers: {
                                    'Content-Type': 'text/xml; charset=utf-8',
                                    'SOAPAction': 'http://tempuri.org/GetTransactionsLog'
                                },
                                timeout: requestTimeoutMs,
                                validateStatus: () => true
                            },
                            { retries }
                        );
                        const soapResponseTime = Date.now() - soapStartTime;
                        console.log(`✅ SOAP request successful: Status ${soapResponse.status}, Time: ${soapResponseTime}ms`);
                        console.log(`Response data length: ${soapResponse.data ? soapResponse.data.length : 0}`);
                       
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            message: 'Catalyst connectivity test completed',
                            results: {
                                httpGetTime: responseTime,
                                soapRequestTime: soapResponseTime,
                                soapResponseStatus: soapResponse.status,
                                soapResponseLength: soapResponse.data ? soapResponse.data.length : 0
                            }
                        }));
                    } catch (soapError) {
                        const soapResponseTime = Date.now() - soapStartTime;
                        console.log(`❌ SOAP request failed: ${soapError.message}, Time: ${soapResponseTime}ms`);
                       
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            message: 'Catalyst connectivity test failed',
                            error: soapError.message,
                            results: {
                                httpGetTime: responseTime,
                                soapRequestTime: soapResponseTime,
                                soapError: soapError.code || 'UNKNOWN'
                            }
                        }));
                    }
                    return;
                } catch (testError) {
                    console.error('Connectivity test error:', testError);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Connectivity test failed', message: testError.message }));
                    return;
                }
            }
           
            if (!fromDateTime || !toDateTime) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'fromDateTime and toDateTime are required' }));
                return;
            }
           
            try {
                console.log(`Starting BuildHr data fetch for range: ${fromDateTime} to ${toDateTime}`);
                const fetchPromise = fetchAndStoreAttendance(catalystApp, fromDateTime, toDateTime, {
                    requestTimeoutMs,
                    retries,
                    url: esslUrl,
                    ...(esslSerial ? { serial: esslSerial } : {}),
                    userName: esslUser,
                    userPassword: esslPassword
                });
                const result = await withTimeout(fetchPromise, functionTimeoutMs, 'Function timeout - processing took too long');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (error) {
                console.error('FetchESSLData timeout or error:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Request timeout or processing error',
                    message: error.message,
                    probeDetails: error && error.probeDetails ? error.probeDetails : undefined,
                    suggestion: 'Check ESSL URL/credentials/serial, try /server/attendance_function?test=true, or verify ESSL server is reachable from Catalyst'
                }));
            }
            return;
        }
       
        // Handle GET request for reading attendance data
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const pageSize = parseInt(url.searchParams.get('pageSize') || '200', 10);
       
        const zcql = catalystApp.zcql();
        const offset = (page - 1) * pageSize;
        let query = 'SELECT EmployeeID, EmployeeName, EventTime, Direction, DeviceSerial, ROWID FROM BHR';
        let countQuery = 'SELECT COUNT(ROWID) as total FROM BHR';
       
        if (startDate && endDate) {
            query += ` WHERE EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDate} 23:59:59'`;
            countQuery += ` WHERE EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDate} 23:59:59'`;
        }
       
        query += ` ORDER BY ROWID DESC LIMIT ${pageSize} OFFSET ${offset}`;
        const rawResults = await zcql.executeZCQLQuery(query);
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
        const rowsWithNames = rows.map(row => ({
            ...row,
            EmployeeName: row.EmployeeName || employeeNameMap[row.EmployeeID] || ''
        }));
       
        const countResult = await zcql.executeZCQLQuery(countQuery);
        const totalCount = Number(countResult[0].BHR['COUNT(ROWID)'] || 0);
       
        const hasMore = rows.length === pageSize;
       
        // Summary mode: earliest IN and latest OUT per employee per date
        if (url.searchParams.get('summary') === 'true') {
            const IN_DEVICE = 'QJT3253600159';
            let allRows = [];
            let offset = 0;
            const batchSize = 300;
            let more = true;
           
            while (more) {
                let summaryQuery = 'SELECT EmployeeID, EmployeeName, EventTime, Direction, DeviceSerial, ROWID FROM BHR';
                if (startDate && endDate) {
                    summaryQuery += ` WHERE EventTime >= '${startDate} 00:00:00' AND EventTime <= '${endDate} 23:59:59'`;
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
           
            // Group and summarize
            const summary = {};
            allRows.forEach(r => {
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
                if (r.Direction === 'in') {
                    // Earliest time as FirstIN
                    if (!summary[key].FirstIN || r.EventTime < summary[key].FirstIN) {
                        summary[key].FirstIN = r.EventTime;
                    }
                } else if (r.Direction === 'out') {
                    // Latest time as LastOUT
                    if (!summary[key].LastOUT || r.EventTime > summary[key].LastOUT) {
                        summary[key].LastOUT = r.EventTime;
                    }
                }
            });
           
            const summaryArr = Object.values(summary);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: summaryArr, hasMore: false, totalCount: summaryArr.length }));
            return;
        }
       
        // Send response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: rowsWithNames, hasMore, totalCount }));
    } catch (error) {
        console.error('Error in FetchESSLData:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
};
