function serializeHeaders(headers) {
  return JSON.stringify(Object.fromEntries(new Headers(headers || {}).entries()));
}

function serializeBody(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  try { return JSON.stringify(body); }
  catch { return String(body); }
}

async function saveExternalApiCall(env, entry) {
  try {
    await env.DB.prepare(`
      INSERT INTO external_api_calls (
        company_id, service, call_source, request_started_at, response_received_at, duration_ms,
        request_method, request_url, request_headers, request_body,
        response_status, response_status_text, response_headers, response_body,
        success, error_name, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      Number(entry.companyId) || 0,
      entry.service,
      entry.callSource || 'backend',
      entry.requestStartedAt,
      entry.responseReceivedAt,
      entry.durationMs,
      entry.requestMethod,
      entry.requestUrl,
      entry.requestHeaders,
      entry.requestBody,
      entry.responseStatus,
      entry.responseStatusText,
      entry.responseHeaders,
      entry.responseBody,
      entry.success ? 1 : 0,
      entry.errorName,
      entry.errorMessage
    ).run();
  } catch (error) {
    console.error('Could not log external API call:', error.message);
  }
}

export async function externalApiFetch(env, service, companyId, url, init = {}, fetcher = fetch) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const requestMethod = String(init.method || 'GET').toUpperCase();
  const baseEntry = {
    companyId,
    service,
    callSource: 'backend',
    requestStartedAt: startedAt.toISOString(),
    requestMethod,
    requestUrl: String(url),
    requestHeaders: serializeHeaders(init.headers),
    requestBody: serializeBody(init.body)
  };

  try {
    const response = await fetcher(url, init);
    const responseBody = await response.clone().text();
    const responseReceivedAt = new Date();

    await saveExternalApiCall(env, {
      ...baseEntry,
      responseReceivedAt: responseReceivedAt.toISOString(),
      durationMs: Date.now() - startedMs,
      responseStatus: response.status,
      responseStatusText: response.statusText,
      responseHeaders: serializeHeaders(response.headers),
      responseBody,
      success: response.ok,
      errorName: null,
      errorMessage: null
    });

    return response;
  } catch (error) {
    const responseReceivedAt = new Date();
    await saveExternalApiCall(env, {
      ...baseEntry,
      responseReceivedAt: responseReceivedAt.toISOString(),
      durationMs: Date.now() - startedMs,
      responseStatus: null,
      responseStatusText: null,
      responseHeaders: null,
      responseBody: null,
      success: false,
      errorName: error.name || 'Error',
      errorMessage: error.message || String(error)
    });
    throw error;
  }
}

function serializeClientField(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

export async function logFrontendApiCall(env, companyId, payload) {
  const requestUrl = String(payload?.requestUrl || '');
  let parsedUrl;
  try { parsedUrl = new URL(requestUrl); }
  catch { throw new Error('A valid frontend request URL is required.'); }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP(S) frontend calls can be logged.');
  }

  const startedAt = payload.requestStartedAt ? new Date(payload.requestStartedAt) : new Date();
  const receivedAt = payload.responseReceivedAt ? new Date(payload.responseReceivedAt) : null;
  if (Number.isNaN(startedAt.getTime()) || (receivedAt && Number.isNaN(receivedAt.getTime()))) {
    throw new Error('Invalid frontend call timestamp.');
  }

  await saveExternalApiCall(env, {
    companyId,
    service: String(payload.service || parsedUrl.hostname || 'browser'),
    callSource: 'frontend',
    requestStartedAt: startedAt.toISOString(),
    responseReceivedAt: receivedAt?.toISOString() || null,
    durationMs: Number.isFinite(Number(payload.durationMs)) ? Math.max(0, Math.round(Number(payload.durationMs))) : null,
    requestMethod: String(payload.requestMethod || 'GET').toUpperCase(),
    requestUrl,
    requestHeaders: serializeClientField(payload.requestHeaders),
    requestBody: serializeClientField(payload.requestBody),
    responseStatus: payload.responseStatus !== undefined && payload.responseStatus !== null && Number.isInteger(Number(payload.responseStatus))
      ? Number(payload.responseStatus)
      : null,
    responseStatusText: payload.responseStatusText ? String(payload.responseStatusText) : null,
    responseHeaders: serializeClientField(payload.responseHeaders),
    responseBody: serializeClientField(payload.responseBody),
    success: payload.success === true,
    errorName: payload.errorName ? String(payload.errorName) : null,
    errorMessage: payload.errorMessage ? String(payload.errorMessage) : null
  });
}
