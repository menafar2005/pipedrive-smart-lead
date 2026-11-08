import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import worker from "../src";
import { externalApiFetch } from "../src/externalApi.js";

beforeAll(async () => {
	await env.DB.prepare("DROP TABLE IF EXISTS external_api_calls").run();
	await env.DB.prepare("DROP TABLE IF EXISTS temprory_tokens").run();
	await env.DB.prepare(`
		CREATE TABLE IF NOT EXISTS rate_limits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			company_id INTEGER NOT NULL,
			route_key TEXT NOT NULL,
			window_start INTEGER NOT NULL,
			request_count INTEGER NOT NULL DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			request_received_at DATETIME, request TEXT, request_method TEXT,
			request_url TEXT, request_path TEXT, request_query TEXT, request_headers TEXT,
			request_body TEXT, request_ip TEXT, request_user_agent TEXT,
			request_content_type TEXT, request_country TEXT,
			UNIQUE(company_id, route_key, window_start)
		)
	`).run();
	await env.DB.prepare(`
		CREATE TABLE IF NOT EXISTS external_api_calls (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			company_id INTEGER NOT NULL DEFAULT 0,
			service TEXT NOT NULL,
			call_source TEXT NOT NULL DEFAULT 'backend' CHECK(call_source IN ('backend', 'frontend')),
			request_started_at DATETIME NOT NULL,
			response_received_at DATETIME,
			duration_ms INTEGER,
			request_method TEXT NOT NULL,
			request_url TEXT NOT NULL,
			request_headers TEXT,
			request_body TEXT,
			response_status INTEGER,
			response_status_text TEXT,
			response_headers TEXT,
			response_body TEXT,
			success INTEGER NOT NULL DEFAULT 0,
			error_name TEXT,
			error_message TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
	await env.DB.prepare(`
		CREATE TABLE temprory_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token TEXT NOT NULL UNIQUE,
			header TEXT NOT NULL,
			payload TEXT NOT NULL,
			algorithm TEXT,
			token_type TEXT,
			signature TEXT NOT NULL,
			user_id INTEGER NOT NULL,
			company_id INTEGER NOT NULL,
			issued_at INTEGER,
			expires_at INTEGER,
			not_before INTEGER,
			jwt_id TEXT,
			token_source TEXT,
			first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			use_count INTEGER NOT NULL DEFAULT 1,
			last_request_method TEXT,
			last_request_path TEXT,
			last_request_ip TEXT,
			last_request_user_agent TEXT
		)
	`).run();
});

function base64Url(value) {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPipedriveToken(companyId, userId) {
	const issuedAt = Math.floor(Date.now() / 1000);
	const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const payload = base64Url(JSON.stringify({ companyId, userId, iat: issuedAt, exp: issuedAt + 300 }));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.PIPEDRIVE_JWT_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
	return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

describe("Pipedrive Smart Assignment worker", () => {
	it("responds with the app status (unit style)", async () => {
		const request = new Request("http://example.com");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Pipedrive Smart Assignment App Running"`);
	});

	it("responds with the app status (integration style)", async () => {
		const response = await SELF.fetch("http://example.com");
		expect(await response.text()).toMatchInlineSnapshot(`"Pipedrive Smart Assignment App Running"`);
	});

	it("rejects direct access to the company analysis page", async () => {
		const response = await SELF.fetch("http://example.com/company-sales-analysis");
		expect(response.status).toBe(401);
	});

	it("serves the SDK lab only with a valid Pipedrive JWT", async () => {
		const directResponse = await SELF.fetch("http://example.com/sdk-lab");
		expect(directResponse.status).toBe(401);

		const token = await createPipedriveToken(765, 432);
		const url = new URL("http://example.com/sdk-lab");
		url.searchParams.set("token", token);
		url.searchParams.set("id", "sdk-lab-test");
		const response = await SELF.fetch(url);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(html).toContain("آزمایشگاه کامل SDK");
		expect(html).toContain("SHOW_SNACKBAR");
		expect(html).toContain("PAGE_VISIBILITY_STATE");
		expect(html).toContain("SDK DEBUG CONSOLE");
		expect(html).toContain("SDK initialization timed out after 10 seconds");
		expect(html).toContain("UNHANDLED_REJECTION");
	});

	it("serves the company analysis page only for a matching organization detail context", async () => {
		const token = await createPipedriveToken(123, 456);
		const validUrl = new URL("http://example.com/company-sales-analysis");
		validUrl.search = new URLSearchParams({
			resource: "organization", view: "details", companyId: "123", userId: "456",
			selectedIds: "789", token
		}).toString();
		const validResponse = await SELF.fetch(validUrl);
		expect(validResponse.status).toBe(200);
		expect(await validResponse.text()).toContain("تحلیل هوشمند شرکت");

		validUrl.searchParams.set("resource", "deal");
		const invalidResponse = await SELF.fetch(validUrl);
		expect(invalidResponse.status).toBe(403);
	});

	it("stores each verified Pipedrive JWT with decoded fields and usage metadata", async () => {
		const token = await createPipedriveToken(222, 333);
		const url = new URL("http://example.com/company-sales-analysis");
		url.search = new URLSearchParams({
			resource: "organization", view: "details", companyId: "222", userId: "333",
			selectedIds: "444", token
		}).toString();

		const firstResponse = await SELF.fetch(url);
		const secondResponse = await SELF.fetch(url);
		expect(firstResponse.status).toBe(200);
		expect(secondResponse.status).toBe(200);

		const stored = await env.DB.prepare(`
			SELECT * FROM temprory_tokens WHERE token = ?
		`).bind(token).first();
		const header = JSON.parse(stored.header);
		const payload = JSON.parse(stored.payload);

		expect(stored).toMatchObject({
			token,
			algorithm: "HS256",
			token_type: "JWT",
			user_id: 333,
			company_id: 222,
			token_source: "query",
			use_count: 2,
			last_request_method: "GET",
			last_request_path: "/company-sales-analysis"
		});
		expect(header).toEqual({ alg: "HS256", typ: "JWT" });
		expect(payload).toMatchObject({ userId: 333, companyId: 222 });
		expect(stored.issued_at).toBe(payload.iat);
		expect(stored.expires_at).toBe(payload.exp);
	});

	it("logs every request, including OAuth routes, without applying a new limit", async () => {
		const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limits WHERE route_key LIKE 'request:%'").first();
		await SELF.fetch(new Request("http://example.com/oauth/start?source=test", { redirect: "manual" }));
		await SELF.fetch("http://example.com/oauth/callback?error=access_denied&source=test");
		const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limits WHERE route_key LIKE 'request:%'").first();
		expect(Number(after.count)).toBe(Number(before.count) + 2);

		const callbackLog = await env.DB.prepare(`
			SELECT request_method, request_path, request_query
			FROM rate_limits WHERE request_path = '/oauth/callback'
			ORDER BY id DESC LIMIT 1
		`).first();
		expect(callbackLog).toMatchObject({
			request_method: "GET",
			request_path: "/oauth/callback",
			request_query: "?error=access_denied&source=test"
		});
	});

	it("stores complete external API request and response data", async () => {
		const response = await externalApiFetch(
			env,
			"test-service",
			321,
			"https://api.example.com/items?full=true",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Api-Key": "secret" },
				body: JSON.stringify({ name: "sample", count: 2 })
			},
			async () => new Response(JSON.stringify({ id: 9, saved: true, nested: { value: "complete" } }), {
				status: 201,
				statusText: "Created",
				headers: { "Content-Type": "application/json", "X-Request-Id": "req-123" }
			})
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ id: 9, saved: true, nested: { value: "complete" } });

		const log = await env.DB.prepare(`
			SELECT * FROM external_api_calls
			WHERE service = 'test-service'
			ORDER BY id DESC LIMIT 1
		`).first();
		expect(log).toMatchObject({
			company_id: 321,
			call_source: "backend",
			request_method: "POST",
			request_url: "https://api.example.com/items?full=true",
			request_body: JSON.stringify({ name: "sample", count: 2 }),
			response_status: 201,
			response_status_text: "Created",
			response_body: JSON.stringify({ id: 9, saved: true, nested: { value: "complete" } }),
			success: 1
		});
		expect(JSON.parse(log.request_headers)).toMatchObject({ "content-type": "application/json", "x-api-key": "secret" });
		expect(JSON.parse(log.response_headers)).toMatchObject({ "content-type": "application/json", "x-request-id": "req-123" });
	});

	it("stores authenticated browser calls as frontend calls", async () => {
		const token = await createPipedriveToken(654, 987);
		const response = await SELF.fetch("http://example.com/api/external-call-log", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Pipedrive-Token": token
			},
			body: JSON.stringify({
				service: "cdn.example.com",
				requestStartedAt: "2026-07-15T08:00:00.000Z",
				responseReceivedAt: "2026-07-15T08:00:00.125Z",
				durationMs: 125,
				requestMethod: "GET",
				requestUrl: "https://cdn.example.com/sdk.js",
				requestHeaders: { accept: "text/javascript" },
				responseStatus: 200,
				responseStatusText: "OK",
				responseHeaders: { "content-type": "text/javascript" },
				responseBody: "window.Example = true;",
				success: true
			})
		});

		expect(response.status).toBe(200);
		const log = await env.DB.prepare(`
			SELECT * FROM external_api_calls
			WHERE request_url = 'https://cdn.example.com/sdk.js'
			ORDER BY id DESC LIMIT 1
		`).first();
		expect(log).toMatchObject({
			company_id: 654,
			service: "cdn.example.com",
			call_source: "frontend",
			request_method: "GET",
			response_status: 200,
			response_body: "window.Example = true;",
			success: 1
		});
	});
});
