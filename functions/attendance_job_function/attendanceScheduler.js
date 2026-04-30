const catalyst = require('zcatalyst-sdk-node');
const axios = require('axios');
const xml2js = require('xml2js');
const {
    readPositiveInt,
    readNonNegativeInt,
    buildEsslEndpointCandidates,
    resolveEsslEndpoint,
    postWithRetry
} = require('./esslSoapClient');

const DEFAULT_ESSL_URL = 'http://www.esslcloud.com/SSINDUST/Main.aspx';
const DEFAULT_USER = 'SSINDUST';
const DEFAULT_PASSWORD = 'SSIndust@2026';
/** Same device pair as attendance_function FetchESSLData defaults */
const DEFAULT_SERIALS = [
    { serial: 'QJT3253600159', direction: 'in' },
    { serial: 'QJT3253600233', direction: 'out' }
];

/**
 * Format as `YYYY-MM-DD HH:mm:ss` in a given IANA timezone (eSSL expects local wall time, not UTC).
 * @param {Date} date
 * @param {string} [timeZone]
 */
function formatLocalSqlDateTime(date, timeZone) {
    const tz = timeZone || process.env.CATALYST_JOB_TIMEZONE || 'Asia/Kolkata';
    return date.toLocaleString('sv-SE', { timeZone: tz, hour12: false });
}

function getSerialsFromEnv() {
    const raw = process.env.ESSL_SERIALS;
    if (!raw || !String(raw).trim()) {
        return DEFAULT_SERIALS;
    }
    const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return [
            { serial: parts[0], direction: 'in' },
            { serial: parts[1], direction: 'out' }
        ];
    }
    if (parts.length === 1) {
        return [{ serial: parts[0], direction: 'in' }];
    }
    return DEFAULT_SERIALS;
}

/**
 *
 * @param {import("./types/job").JobRequest} jobRequest
 * @param {import("./types/job").Context} context
 */
module.exports = async (jobRequest, context) => {
    try {
        const catalystApp = catalyst.initialize(context);
        const dataStore = catalystApp.datastore();
        const table = dataStore.table('BHR');

        const serials = getSerialsFromEnv();
        const esslUrl = process.env.ESSL_URL || DEFAULT_ESSL_URL;
        const userName = process.env.ESSL_USERNAME || DEFAULT_USER;
        const userPassword = process.env.ESSL_PASSWORD || DEFAULT_PASSWORD;

        const requestTimeoutMs = readPositiveInt(process.env.ESSL_TIMEOUT_MS, 90000);
        const retryOptions = {
            retries: readNonNegativeInt(process.env.ESSL_RETRIES, 0),
            baseDelayMs: readPositiveInt(process.env.ESSL_RETRY_BASE_DELAY_MS, 500),
            maxDelayMs: readPositiveInt(process.env.ESSL_RETRY_MAX_DELAY_MS, 5000)
        };

        const jobTz = process.env.CATALYST_JOB_TIMEZONE || 'Asia/Kolkata';
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setHours(fromDate.getHours() - 36);

        const fromDateTime = formatLocalSqlDateTime(fromDate, jobTz);
        const toDateTime = formatLocalSqlDateTime(toDate, jobTz);

        console.log(
            `Job: ESSL window (${jobTz}): ${fromDateTime} → ${toDateTime} | URL=${esslUrl} | serials=${serials.map((s) => s.serial).join(',')}`
        );

        const soapHeaders = {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': 'http://tempuri.org/GetTransactionsLog'
        };

        const firstSerial = serials[0].serial;
        const probeSoapBody = `
            <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                <soap:Body>
                    <GetTransactionsLog xmlns="http://tempuri.org/">
                        <FromDateTime>${fromDateTime}</FromDateTime>
                        <ToDateTime>${toDateTime}</ToDateTime>
                        <SerialNumber>${firstSerial}</SerialNumber>
                        <UserName>${userName}</UserName>
                        <UserPassword>${userPassword}</UserPassword>
                        <strDataList>123</strDataList>
                    </GetTransactionsLog>
                </soap:Body>
            </soap:Envelope>
        `;

        const endpointCandidates = buildEsslEndpointCandidates(esslUrl);
        const resolvedEndpoint = await resolveEsslEndpoint(endpointCandidates, probeSoapBody, {
            probeTimeoutMs: Math.min(15000, Math.max(6000, Math.floor(requestTimeoutMs / 10))),
            headers: soapHeaders
        });

        let totalInsertedCount = 0;
        for (const { serial, direction } of serials) {
            const soapBody = `
            <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                <soap:Body>
                    <GetTransactionsLog xmlns="http://tempuri.org/">
                        <FromDateTime>${fromDateTime}</FromDateTime>
                        <ToDateTime>${toDateTime}</ToDateTime>
                        <SerialNumber>${serial}</SerialNumber>
                        <UserName>${userName}</UserName>
                        <UserPassword>${userPassword}</UserPassword>
                        <strDataList>123</strDataList>
                    </GetTransactionsLog>
                </soap:Body>
            </soap:Envelope>
          `;

            const response = await postWithRetry(
                resolvedEndpoint,
                soapBody,
                {
                    headers: {
                        ...soapHeaders,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        Accept: 'text/xml, application/xml, */*',
                        'Accept-Encoding': 'gzip, deflate',
                        Connection: 'keep-alive'
                    },
                    timeout: requestTimeoutMs,
                    maxRedirects: 0,
                    validateStatus(status) {
                        return status >= 200 && status < 500;
                    }
                },
                retryOptions
            );

            if (response.status !== 200) {
                throw new Error(`ESSL cloud returned status ${response.status}: ${response.statusText}`);
            }

            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
            const result = await parser.parseStringPromise(response.data);

            const body = result['soap:Envelope'] && result['soap:Envelope']['soap:Body'];
            const gtl =
                body &&
                (body['GetTransactionsLogResponse'] ||
                    body['gettransactionslogresponse'] ||
                    body['GettransactionslogResponse']);
            const transactionsString = gtl && (gtl.strDataList || gtl['strDataList']);

            if (!transactionsString || !String(transactionsString).trim()) {
                const preview =
                    typeof response.data === 'string'
                        ? response.data.slice(0, 600).replace(/\s+/g, ' ')
                        : '';
                console.warn(
                    `No strDataList for device ${serial} (empty or SOAP fault). Response preview: ${preview}`
                );
                continue;
            }

            const lines = transactionsString.split('\n').map(line => line.trim()).filter(line => line);

            let insertedCount = 0;
            console.log(`Processing ${lines.length} lines for device ${serial} (${direction})`);
            for (const line of lines) {
                const parts = line.split(/\s+/);
                let EmployeeID;
                let EventTime;
                let logDirection;
                if (parts.length >= 4) {
                    EmployeeID = parts[0];
                    EventTime = `${parts[1]} ${parts[2]}`;
                    logDirection = parts[3].toLowerCase();
                    console.log(`Found record with direction: ${logDirection} for employee ${EmployeeID}`);
                } else if (parts.length === 3) {
                    EmployeeID = parts[0];
                    EventTime = `${parts[1]} ${parts[2]}`;
                    logDirection = direction;
                    console.log(`Using assigned direction: ${logDirection} for employee ${EmployeeID}`);
                } else {
                    console.warn(`Skipping line (not enough parts): '${line}'`);
                    continue;
                }

                const isValidDateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(EventTime);
                if (!isValidDateTime) {
                    console.warn(`Skipping invalid EventTime: ${EventTime} for EmployeeID: ${EmployeeID} (full line: '${line}')`);
                    continue;
                }

                const query = `SELECT CREATEDTIME FROM BHR WHERE EmployeeID = '${EmployeeID}' AND EventTime = '${EventTime}' AND Direction = '${logDirection}' AND DeviceSerial = '${serial}'`;
                const existing = await catalystApp.zcql().executeZCQLQuery(query);

                if (existing.length === 0) {
                    await table.insertRow({ EmployeeID, EventTime, Direction: logDirection, DeviceSerial: serial });
                    insertedCount++;
                }
            }
            totalInsertedCount += insertedCount;
            console.log(`Device ${serial} (${direction}): ${insertedCount} records inserted`);
        }
        console.log(`Job: ESSL cloud data fetched and stored successfully, total transaction_count: ${totalInsertedCount}`);
        context.closeWithSuccess();
    } catch (error) {
        console.error('Job: Error fetching ESSL cloud data:', error.message);
        if (error.probeDetails) {
            console.error('ESSL endpoint probe details:', error.probeDetails);
        }
        if (error.response) {
            console.error('Response Data:', error.response.data);
        }
        context.closeWithFailure();
    }
};
