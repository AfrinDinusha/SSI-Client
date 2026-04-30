'use strict';

const axios = require('axios');

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
    if (trimmed.toLowerCase().includes('.asmx')) return trimmed;
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
    const error = new Error(`Unable to reach ESSL SOAP endpoint. Probed ${candidates.length} URL(s).`);
    error.probeDetails = failures.slice(0, 5);
    throw error;
}

async function postWithRetry(url, body, axiosConfig, options) {
    const maxRetries = readNonNegativeInt(options && options.retries, 0);
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

module.exports = {
    readPositiveInt,
    readNonNegativeInt,
    buildEsslEndpointCandidates,
    resolveEsslEndpoint,
    postWithRetry
};
