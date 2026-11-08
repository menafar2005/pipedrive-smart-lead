import { getFrontendApiLoggerScript } from './frontendApiLogger.js';

export async function getSidebarPage() {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Assignment Summary</title>
  ${getFrontendApiLoggerScript()}
  <script src="https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/dist/index.umd.js"></script>
  <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; color: #17233c; background: #ffffff; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    .description { font-size: 13px; color: #5f6b7a; line-height: 1.5; margin-bottom: 12px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #ffffff; }
    .cardTitle { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    .userRow { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f2f5; padding: 8px 0; gap: 8px; }
    .userRow:last-child { border-bottom: 0; }
    .userName { font-size: 13px; font-weight: 600; }
    .userMeta { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .badge { font-size: 12px; border-radius: 999px; padding: 4px 8px; background: #eef2f7; white-space: nowrap; }
    .badge.full { background: #fff0f0; color: #c03535; }
    .badge.ok { background: #ecfdf3; color: #0b7a3b; }
    .badge.paused { background: #fff7ed; color: #c2410c; }
    .progress { width: 100%; height: 6px; background: #eef2f7; border-radius: 999px; margin-top: 6px; overflow: hidden; }
    .progressBar { height: 100%; background: #317ae2; width: 0%; }
    .progressBar.paused { background: #f97316; }
    .assignmentItem { font-size: 12px; color: #374151; border-bottom: 1px solid #f0f2f5; padding: 8px 0; }
    .assignmentItem:last-child { border-bottom: 0; }
    .empty { font-size: 13px; color: #6b7280; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    .status { font-size: 13px; color: #6b7280; margin-top: 8px; }
    .error { color: #c03535; }
    button { border: 0; border-radius: 6px; padding: 8px 10px; background: #eef2f7; color: #17233c; cursor: pointer; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Smart Assignment</h1>
  <div class="description">Today's capacity and round-robin assignment status.</div>
  <div class="card"><div class="cardTitle">Next available user</div><div id="nextUser" class="empty">Loading...</div></div>
  <div class="card"><div class="cardTitle">Today capacity</div><div id="usersList"></div></div>
  <div class="card"><div class="cardTitle">Latest assignments</div><div id="latestAssignments"></div></div>
  <button id="refreshButton">Refresh</button>
  <div id="status" class="status"></div>
  <script>
    let sdk = null;
    function getPipedriveToken() { return new URLSearchParams(window.location.search).get('token') || ''; }
    async function initSdk() {
      try {
        const id = new URLSearchParams(window.location.search).get('id');
        if (!window.AppExtensionsSDK) throw new Error('AppExtensionsSDK was not loaded.');
        if (id) sdk = await new window.AppExtensionsSDK({ identifier: id }).initialize({ size: { width: 360, height: 700 } });
        else sdk = await new window.AppExtensionsSDK().initialize({ size: { width: 360, height: 700 } });
      } catch (error) { console.error('Sidebar SDK init failed', error); }
    }
    const sdkReady = initSdk();
    function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
    function setStatus(message, isError) { $('#status').toggleClass('error', Boolean(isError)).text(message || ''); }
    function renderNextUser(summary) {
      if (!summary.next_available_user) { $('#nextUser').html('No user has remaining capacity.'); return; }
      $('#nextUser').html('<strong>' + escapeHtml(summary.next_available_user.name || summary.next_available_user.id) + '</strong>');
    }
    function renderUsers(summary) {
      if (!summary.users || summary.users.length === 0) { $('#usersList').html('<div class="empty">No capacity configured.</div>'); return; }
      const html = summary.users.map(user => {
        const assigned = Number(user.assigned_today || 0);
        const capacity = Number(user.daily_capacity || 0);
        const remaining = Number(user.remaining || 0);
        const paused = Boolean(user.paused_today);
        const percent = capacity > 0 ? Math.min(100, Math.round((assigned / capacity) * 100)) : 0;
        const badgeClass = paused ? 'paused' : remaining <= 0 ? 'full' : 'ok';
        const badgeText = paused ? 'Paused' : assigned + ' / ' + capacity;
        const metaText = paused ? 'Paused today' : 'Remaining: ' + remaining;
        const barClass = paused ? 'paused' : '';
        return '<div class="userRow"><div style="flex:1;"><div class="userName">' + escapeHtml(user.user_name || user.user_id) + '</div><div class="userMeta">' + escapeHtml(metaText) + '</div><div class="progress"><div class="progressBar ' + barClass + '" style="width:' + percent + '%"></div></div></div><div class="badge ' + badgeClass + '">' + escapeHtml(badgeText) + '</div></div>';
      }).join('');
      $('#usersList').html(html);
    }
    function renderLatestAssignments(summary) {
      const items = summary.latest_assignments || [];
      if (items.length === 0) { $('#latestAssignments').html('<div class="empty">No assignments yet.</div>'); return; }
      const html = items.map(item => '<div class="assignmentItem">Deal #' + escapeHtml(item.deal_id) + ' assigned to <strong>' + escapeHtml(item.assigned_user_name || item.assigned_user_id) + '</strong><br>Score: ' + escapeHtml(item.score || 0) + ' · ' + escapeHtml(item.created_at || '') + '</div>').join('');
      $('#latestAssignments').html(html);
    }
    async function loadSummary() {
      setStatus('Loading...');
      const response = await fetch('/api/assignment-summary', { headers: { 'X-Pipedrive-Token': getPipedriveToken() } });
      const summary = await response.json();
      if (!response.ok || !summary.success) throw new Error(summary.message || summary.error || 'Could not load assignment summary.');
      renderNextUser(summary); renderUsers(summary); renderLatestAssignments(summary); setStatus('');
    }
    $(document).on('click', '#refreshButton', function () { loadSummary().catch(error => setStatus(error.message, true)); });
    (async function boot() { try { await sdkReady; await loadSummary(); } catch (error) { setStatus(error.message, true); } })();
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
