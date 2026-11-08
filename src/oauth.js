import {
	setupInstalledCompany
} from "./appSetup.js";
import { externalApiFetch } from "./externalApi.js";

function htmlResponse(content, status = 200) {
	return new Response(content, {
		status,
		headers: {
			"Content-Type": "text/html; charset=utf-8"
		}
	});
}

function jsonResponse(data, status = 200) {
	return Response.json(data, { status });
}

function getRequiredEnv(env, key) {
	const value = env[key];

	if (!value) {
		throw new Error(`${key} is not configured.`);
	}

	return value;
}

function getRedirectUri(request, env) {
	if (env.PIPEDRIVE_REDIRECT_URI) {
		return env.PIPEDRIVE_REDIRECT_URI;
	}

	const url = new URL(request.url);

	return `${url.protocol}//${url.host}/oauth/callback`;
}

function buildPipedriveAuthorizeUrl(request, env) {
	const clientId = getRequiredEnv(env, "PIPEDRIVE_CLIENT_ID");
	const redirectUri = getRedirectUri(request, env);

	const authorizeUrl = new URL("https://oauth.pipedrive.com/oauth/authorize");

	authorizeUrl.searchParams.set("client_id", clientId);
	authorizeUrl.searchParams.set("redirect_uri", redirectUri);

	return authorizeUrl.toString();
}

async function exchangeCodeForToken(request, env, code) {
	const clientId = getRequiredEnv(env, "PIPEDRIVE_CLIENT_ID");
	const clientSecret = getRequiredEnv(env, "PIPEDRIVE_CLIENT_SECRET");
	const redirectUri = getRedirectUri(request, env);

	const body = new URLSearchParams();

	body.set("grant_type", "authorization_code");
	body.set("code", code);
	body.set("redirect_uri", redirectUri);
	body.set("client_id", clientId);
	body.set("client_secret", clientSecret);

	const response = await externalApiFetch(env, "pipedrive-oauth", 0, "https://oauth.pipedrive.com/oauth/token", {
		method: "POST",
		headers: {
			"Accept": "application/json",
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body
	});

	const data = await response.json();

	if (!response.ok) {
		throw new Error(
			data.error_description ||
			data.error ||
			"Could not exchange OAuth code for token."
		);
	}

	if (!data.access_token || !data.refresh_token) {
		throw new Error("OAuth token response is missing access_token or refresh_token.");
	}

	return data;
}

async function getCurrentUserFromPipedrive(env, apiDomain, accessToken) {
	const response = await externalApiFetch(env, "pipedrive", 0, `${apiDomain}/api/v1/users/me`, {
		method: "GET",
		headers: {
			"Accept": "application/json",
			"Authorization": `Bearer ${accessToken}`
		}
	});

	const data = await response.json();

	if (!response.ok || data.success === false) {
		throw new Error(
			data.error ||
			data.error_info ||
			"Could not fetch current Pipedrive user."
		);
	}

	return data.data;
}

function extractCompanyInfo(currentUser) {
	const company =
		currentUser.company ||
		currentUser.company_data ||
		currentUser.companyData ||
		{};

	return {
		companyId: Number(
			company.id ||
			currentUser.company_id ||
			currentUser.companyId ||
			0
		),
		companyName:
			company.name ||
			currentUser.company_name ||
			currentUser.companyName ||
			"",
		companyDomain:
			company.domain ||
			currentUser.company_domain ||
			currentUser.companyDomain ||
			""
	};
}

function extractUserInfo(currentUser) {
	return {
		userId: Number(
			currentUser.id ||
			currentUser.user_id ||
			currentUser.userId ||
			0
		),
		userName:
			currentUser.name ||
			currentUser.user_name ||
			currentUser.userName ||
			currentUser.email ||
			""
	};
}

async function saveOAuthToken(env, tokenData, currentUser) {
	const apiDomain = tokenData.api_domain;

	if (!apiDomain) {
		throw new Error("OAuth token response is missing api_domain.");
	}

	const company = extractCompanyInfo(currentUser);
	const user = extractUserInfo(currentUser);

	if (!company.companyId) {
		throw new Error("Could not detect Pipedrive company_id from current user.");
	}

	if (!user.userId) {
		throw new Error("Could not detect Pipedrive user_id from current user.");
	}

	const expiresInSeconds = Number(tokenData.expires_in || 3600);
	const expiresAt = Date.now() + expiresInSeconds * 1000;

	await env.DB.prepare(`
		INSERT INTO oauth_tokens (
			company_id,
			company_name,
			company_domain,
			api_domain,
			user_id,
			user_name,
			access_token,
			refresh_token,
			expires_at,
			created_at,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`)
		.bind(
			company.companyId,
			company.companyName,
			company.companyDomain,
			apiDomain,
			user.userId,
			user.userName,
			tokenData.access_token,
			tokenData.refresh_token,
			expiresAt
		)
		.run();

	return {
		companyId: company.companyId,
		companyName: company.companyName,
		companyDomain: company.companyDomain,
		apiDomain,
		userId: user.userId,
		userName: user.userName,
		expiresAt
	};
}

function renderSuccessPage(result, setupResult = null) {
	const setupHtml = setupResult
		? `
			<h3>App setup completed</h3>
			<ul>
				<li>Shamsi deal field key: <code>${setupResult.shamsiField?.key || "-"}</code></li>
				<li>Deal created webhook ID: <code>${setupResult.webhook?.id || "-"}</code></li>
			</ul>
		`
		: `
			<h3>App setup skipped</h3>
			<p>OAuth token was saved, but app setup did not return a result.</p>
		`;

	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>Pipedrive app installed</title>
	<style>
		body {
			font-family: Arial, sans-serif;
			padding: 32px;
			line-height: 1.6;
			color: #172b4d;
		}

		.card {
			max-width: 760px;
			border: 1px solid #dfe1e6;
			border-radius: 12px;
			padding: 24px;
			background: #fff;
			box-shadow: 0 2px 8px rgba(9, 30, 66, 0.08);
		}

		code {
			background: #f4f5f7;
			padding: 2px 6px;
			border-radius: 4px;
		}

		.success {
			color: #00875a;
		}
	</style>
</head>
<body>
	<div class="card">
		<h2 class="success">Pipedrive Smart Assignment app installed successfully</h2>

		<p>OAuth connection is complete and the company token has been saved.</p>

		<h3>Connected account</h3>
		<ul>
			<li>Company ID: <code>${result.companyId}</code></li>
			<li>Company name: <code>${result.companyName || "-"}</code></li>
			<li>User ID: <code>${result.userId}</code></li>
			<li>User name: <code>${result.userName || "-"}</code></li>
			<li>API domain: <code>${result.apiDomain}</code></li>
		</ul>

		${setupHtml}

		<p>You can close this page and return to Pipedrive.</p>
	</div>
</body>
</html>`;
}

function renderSetupWarningPage(result, setupError) {
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>Pipedrive app installed with warning</title>
	<style>
		body {
			font-family: Arial, sans-serif;
			padding: 32px;
			line-height: 1.6;
			color: #172b4d;
		}

		.card {
			max-width: 760px;
			border: 1px solid #ffab00;
			border-radius: 12px;
			padding: 24px;
			background: #fffbf0;
		}

		code {
			background: #fff3cd;
			padding: 2px 6px;
			border-radius: 4px;
		}

		.warning {
			color: #974f0c;
		}
	</style>
</head>
<body>
	<div class="card">
		<h2 class="warning">OAuth completed, but app setup failed</h2>

		<p>The OAuth token was saved, but the post-install setup could not finish.</p>

		<h3>Connected account</h3>
		<ul>
			<li>Company ID: <code>${result.companyId}</code></li>
			<li>Company name: <code>${result.companyName || "-"}</code></li>
			<li>User ID: <code>${result.userId}</code></li>
			<li>API domain: <code>${result.apiDomain}</code></li>
		</ul>

		<h3>Setup error</h3>
		<p><code>${setupError.message}</code></p>

		<p>
			Check these items:
		</p>

		<ul>
			<li><code>PIPEDRIVE_WEBHOOK_AUTH_USER</code> secret is configured.</li>
			<li><code>PIPEDRIVE_WEBHOOK_AUTH_PASSWORD</code> secret is configured.</li>
			<li>The app has the required Pipedrive scopes for deal fields and webhooks.</li>
			<li>The webhook URL is publicly reachable and does not redirect.</li>
		</ul>
	</div>
</body>
</html>`;
}

export async function oauthStart(env, request) {
	const authorizeUrl = buildPipedriveAuthorizeUrl(request, env);

	return Response.redirect(authorizeUrl, 302);
}

export async function oauthCallback(request, env) {
	const url = new URL(request.url);

	const error = url.searchParams.get("error");

	if (error) {
		return htmlResponse(
			`OAuth failed: ${error}`,
			400
		);
	}

	const code = url.searchParams.get("code");

	if (!code) {
		return htmlResponse(
			"Missing OAuth code.",
			400
		);
	}

	try {
		const tokenData = await exchangeCodeForToken(request, env, code);

		const currentUser = await getCurrentUserFromPipedrive(
			env,
			tokenData.api_domain,
			tokenData.access_token
		);

		const saved = await saveOAuthToken(
			env,
			tokenData,
			currentUser
		);

		try {
			const setupResult = await setupInstalledCompany(
				env,
				saved.companyId,
				request
			);

			return htmlResponse(
				renderSuccessPage(saved, setupResult)
			);
		} catch (setupError) {
			console.log("App setup failed after OAuth:", setupError.message);

			return htmlResponse(
				renderSetupWarningPage(saved, setupError),
				200
			);
		}
	} catch (callbackError) {
		console.log("OAuth callback error:", callbackError.message);

		return jsonResponse(
			{
				success: false,
				error: callbackError.message
			},
			500
		);
	}
}
