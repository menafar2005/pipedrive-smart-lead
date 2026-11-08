import {
	setupInstalledCompany
} from "./appSetup.js";

function base64UrlToBytes(value) {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

function getTokenFromRequest(request) {
  return getTokenDetailsFromRequest(request).token;
}

function getTokenDetailsFromRequest(request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) return { token: queryToken, source: 'query' };
  const headerToken = request.headers.get('X-Pipedrive-Token') || request.headers.get('x-pipedrive-token');
  if (headerToken) return { token: headerToken, source: 'x-pipedrive-token' };
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) {
    return { token: authorization.slice('Bearer '.length), source: 'authorization-bearer' };
  }
  return { token: null, source: null };
}

async function verifyHs256Jwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(bytesToUtf8(base64UrlToBytes(encodedHeader)));
  const payload = JSON.parse(bytesToUtf8(base64UrlToBytes(encodedPayload)));
  if (header.alg !== 'HS256') throw new Error('Unsupported JWT algorithm.');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  if (!valid) throw new Error('Invalid JWT signature.');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) throw new Error('JWT expired.');
  if (payload.nbf && Number(payload.nbf) > now) throw new Error('JWT not active yet.');

  return { header, payload, signature: encodedSignature };
}

function getCompanyIdFromPayload(payload) {
  return Number(payload.companyId || payload.company_id || payload.companyID || 0);
}

function getUserIdFromPayload(payload) {
  return Number(payload.userId || payload.user_id || payload.userID || 0);
}

function getOptionalNumericClaim(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function saveTemproryToken(env, request, tokenDetails, verified) {
  const { token, source } = tokenDetails;
  const { header, payload, signature } = verified;
  const url = new URL(request.url);

  await env.DB.prepare(`
    INSERT INTO temprory_tokens (
      token, header, payload, algorithm, token_type, signature,
      user_id, company_id, issued_at, expires_at, not_before, jwt_id,
      token_source, first_seen_at, last_seen_at, use_count,
      last_request_method, last_request_path, last_request_ip,
      last_request_user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, 1, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      header = excluded.header,
      payload = excluded.payload,
      algorithm = excluded.algorithm,
      token_type = excluded.token_type,
      signature = excluded.signature,
      user_id = excluded.user_id,
      company_id = excluded.company_id,
      issued_at = excluded.issued_at,
      expires_at = excluded.expires_at,
      not_before = excluded.not_before,
      jwt_id = excluded.jwt_id,
      token_source = excluded.token_source,
      last_seen_at = CURRENT_TIMESTAMP,
      use_count = temprory_tokens.use_count + 1,
      last_request_method = excluded.last_request_method,
      last_request_path = excluded.last_request_path,
      last_request_ip = excluded.last_request_ip,
      last_request_user_agent = excluded.last_request_user_agent
  `).bind(
    token,
    JSON.stringify(header),
    JSON.stringify(payload),
    header.alg || null,
    header.typ || null,
    signature,
    getUserIdFromPayload(payload),
    getCompanyIdFromPayload(payload),
    getOptionalNumericClaim(payload.iat),
    getOptionalNumericClaim(payload.exp),
    getOptionalNumericClaim(payload.nbf),
    payload.jti ? String(payload.jti) : null,
    source,
    request.method,
    url.pathname,
    request.headers.get('CF-Connecting-IP'),
    request.headers.get('User-Agent')
  ).run();
}

export async function requirePipedriveAuth(request, env) {
  const tokenDetails = getTokenDetailsFromRequest(request);
  const token = tokenDetails.token;
  if (!token) {
    throw new Response(JSON.stringify({ success: false, error: 'Missing Pipedrive JWT token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const secret = env.PIPEDRIVE_JWT_SECRET || env.PIPEDRIVE_CLIENT_SECRET;
  if (!secret) {
    throw new Response(JSON.stringify({ success: false, error: 'PIPEDRIVE_JWT_SECRET is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const verified = await verifyHs256Jwt(token, secret);
    const payload = verified.payload;
    const companyId = getCompanyIdFromPayload(payload);
    const userId = getUserIdFromPayload(payload);
    if (!companyId || !userId) throw new Error('JWT does not include companyId/userId.');
    try {
      await saveTemproryToken(env, request, tokenDetails, verified);
    } catch (error) {
      console.error('Could not store verified JWT:', error.message);
    }
    return { token, header: verified.header, payload, companyId, userId };
  } catch (error) {
    throw new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function getRequestDetails(request) {
  const url = new URL(request.url);
  const body = request.body ? await request.clone().text() : null;

  return {
    receivedAt: new Date().toISOString(),
    request: `${request.method} ${request.url}`,
    method: request.method,
    url: request.url,
    path: url.pathname,
    query: url.search,
    headers: JSON.stringify(Object.fromEntries(request.headers)),
    body,
    ip: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
    contentType: request.headers.get('Content-Type'),
    country: request.cf?.country || request.headers.get('CF-IPCountry')
  };
}

export async function logRequest(env, request, companyId = 0) {
  const detailsPromise = getRequestDetails(request);
  let resolvedCompanyId = Number(companyId) || 0;

  if (!resolvedCompanyId) {
    const token = getTokenFromRequest(request);
    const secret = env.PIPEDRIVE_JWT_SECRET || env.PIPEDRIVE_CLIENT_SECRET;
    if (token && secret) {
      try {
        const verified = await verifyHs256Jwt(token, secret);
        resolvedCompanyId = getCompanyIdFromPayload(verified.payload);
      } catch {
        // Invalid requests must still be logged, but are not attributed to a company.
      }
    }
  }

  const details = await detailsPromise;
  const url = new URL(request.url);
  const routeKey = `request:${request.method}:${url.pathname}:${crypto.randomUUID()}`;

  await env.DB.prepare(`
    INSERT INTO rate_limits (
      company_id, route_key, window_start, request_count, updated_at,
      request_received_at, request, request_method, request_url, request_path,
      request_query, request_headers, request_body, request_ip,
      request_user_agent, request_content_type, request_country
    ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    resolvedCompanyId, routeKey, Date.now(), details.receivedAt, details.request,
    details.method, details.url, details.path, details.query, details.headers,
    details.body, details.ip, details.userAgent, details.contentType, details.country
  ).run();
}

function getRateLimitSettings(env, routeKey) {
  const limitKey = `RATE_LIMIT_${routeKey.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
  const limit = Number(env[limitKey]);
  const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`${limitKey} must be a positive integer.`);
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new Error('RATE_LIMIT_WINDOW_SECONDS must be a positive integer.');
  }
  return { limit, windowSeconds };
}

export async function enforceRateLimit(env, companyId, routeKey, request) {
  const { limit, windowSeconds } = getRateLimitSettings(env, routeKey);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const details = await getRequestDetails(request);

  const row = await env.DB.prepare(`
    SELECT request_count
    FROM rate_limits
    WHERE company_id = ? AND route_key = ? AND window_start = ?
  `).bind(companyId, routeKey, windowStart).first();

  if (!row) {
    await env.DB.prepare(`
      INSERT INTO rate_limits (
        company_id, route_key, window_start, request_count, updated_at,
        request_received_at, request, request_method, request_url, request_path,
        request_query, request_headers, request_body, request_ip,
        request_user_agent, request_content_type, request_country
      ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      companyId, routeKey, windowStart, details.receivedAt, details.request,
      details.method, details.url, details.path, details.query, details.headers,
      details.body, details.ip, details.userAgent, details.contentType, details.country
    ).run();
    return;
  }

  const currentCount = Number(row.request_count || 0);
  if (currentCount >= limit) {
    throw new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(windowSeconds) }
    });
  }

  await env.DB.prepare(`
    UPDATE rate_limits
    SET request_count = request_count + 1, updated_at = CURRENT_TIMESTAMP,
        request_received_at = ?, request = ?, request_method = ?, request_url = ?,
        request_path = ?, request_query = ?, request_headers = ?, request_body = ?,
        request_ip = ?, request_user_agent = ?, request_content_type = ?, request_country = ?
    WHERE company_id = ? AND route_key = ? AND window_start = ?
  `).bind(
    details.receivedAt, details.request, details.method, details.url, details.path,
    details.query, details.headers, details.body, details.ip, details.userAgent,
    details.contentType, details.country, companyId, routeKey, windowStart
  ).run();
}
