export function getFrontendApiLoggerScript() {
  return `<script>
(function () {
  if (window.__externalApiLoggerInstalled) return;
  window.__externalApiLoggerInstalled = true;

  var reportEndpoint = '/api/external-call-log';
  var nativeFetch = window.fetch.bind(window);

  function token() {
    return new URLSearchParams(window.location.search).get('token') || '';
  }

  function absoluteUrl(value) {
    try {
      if (value instanceof Request) return new URL(value.url, window.location.href).toString();
      return new URL(String(value), window.location.href).toString();
    } catch (_) { return ''; }
  }

  function isExternal(url) {
    try { return new URL(url).origin !== window.location.origin; }
    catch (_) { return false; }
  }

  function service(url) {
    try { return new URL(url).hostname; }
    catch (_) { return 'browser'; }
  }

  function headersObject(value) {
    try { return Object.fromEntries(new Headers(value || {}).entries()); }
    catch (_) { return {}; }
  }

  function bodyText(value) {
    if (value === undefined || value === null) return Promise.resolve(null);
    if (typeof value === 'string') return Promise.resolve(value);
    if (value instanceof URLSearchParams) return Promise.resolve(value.toString());
    if (value instanceof FormData) {
      var form = {};
      value.forEach(function (item, key) {
        form[key] = item instanceof File ? '[File: ' + item.name + ', ' + item.size + ' bytes]' : String(item);
      });
      return Promise.resolve(JSON.stringify(form));
    }
    if (value instanceof Blob) return value.text();
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      try { return Promise.resolve(new TextDecoder().decode(value)); }
      catch (_) { return Promise.resolve(String(value)); }
    }
    try { return Promise.resolve(JSON.stringify(value)); }
    catch (_) { return Promise.resolve(String(value)); }
  }

  function send(entry) {
    var jwt = token();
    if (!jwt) return;
    nativeFetch(reportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pipedrive-Token': jwt },
      body: JSON.stringify(entry),
      keepalive: true
    }).catch(function () {});
  }

  window.fetch = async function (input, init) {
    init = init || {};
    var url = absoluteUrl(input);
    if (!url || !isExternal(url)) return nativeFetch(input, init);

    var startedMs = Date.now();
    var startedAt = new Date(startedMs).toISOString();
    var method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    var requestHeaders = headersObject(init.headers || (input instanceof Request ? input.headers : {}));
    var requestBody = init.body !== undefined
      ? bodyText(init.body)
      : (input instanceof Request && !['GET', 'HEAD'].includes(method) ? input.clone().text().catch(function () { return null; }) : Promise.resolve(null));

    try {
      var response = await nativeFetch(input, init);
      var receivedMs = Date.now();
      Promise.all([requestBody, response.clone().text().catch(function () { return null; })]).then(function (values) {
        send({
          service: service(url), requestStartedAt: startedAt,
          responseReceivedAt: new Date(receivedMs).toISOString(), durationMs: receivedMs - startedMs,
          requestMethod: method, requestUrl: url, requestHeaders: requestHeaders, requestBody: values[0],
          responseStatus: response.status, responseStatusText: response.statusText,
          responseHeaders: headersObject(response.headers), responseBody: values[1],
          success: response.ok, errorName: null, errorMessage: null
        });
      });
      return response;
    } catch (error) {
      var failedMs = Date.now();
      requestBody.then(function (value) {
        send({
          service: service(url), requestStartedAt: startedAt,
          responseReceivedAt: new Date(failedMs).toISOString(), durationMs: failedMs - startedMs,
          requestMethod: method, requestUrl: url, requestHeaders: requestHeaders, requestBody: value,
          responseStatus: null, responseStatusText: null, responseHeaders: null, responseBody: null,
          success: false, errorName: error.name || 'Error', errorMessage: error.message || String(error)
        });
      });
      throw error;
    }
  };

  var xhrMeta = new WeakMap();
  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  var nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    xhrMeta.set(this, { method: String(method || 'GET').toUpperCase(), url: absoluteUrl(url), headers: {} });
    return nativeOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    var meta = xhrMeta.get(this);
    if (meta) meta.headers[String(name).toLowerCase()] = String(value);
    return nativeSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    var meta = xhrMeta.get(xhr);
    if (!meta || !isExternal(meta.url)) return nativeSend.apply(xhr, arguments);
    var startedMs = Date.now();
    var startedAt = new Date(startedMs).toISOString();
    bodyText(body).then(function (requestBody) { meta.body = requestBody; });
    xhr.addEventListener('loadend', function () {
      var responseBody = null;
      try { responseBody = xhr.responseType === 'json' ? JSON.stringify(xhr.response) : xhr.responseText; }
      catch (_) {}
      var responseHeaders = null;
      try { responseHeaders = xhr.getAllResponseHeaders(); }
      catch (_) {}
      var receivedMs = Date.now();
      send({
        service: service(meta.url), requestStartedAt: startedAt,
        responseReceivedAt: new Date(receivedMs).toISOString(), durationMs: receivedMs - startedMs,
        requestMethod: meta.method, requestUrl: meta.url, requestHeaders: meta.headers, requestBody: meta.body || null,
        responseStatus: xhr.status || null, responseStatusText: xhr.statusText || null,
        responseHeaders: responseHeaders, responseBody: responseBody,
        success: xhr.status >= 200 && xhr.status < 400,
        errorName: xhr.status ? null : 'NetworkError', errorMessage: xhr.status ? null : 'XMLHttpRequest failed.'
      });
    }, { once: true });
    return nativeSend.apply(xhr, arguments);
  };

  if (window.PerformanceObserver) {
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (!isExternal(entry.name) || ['fetch', 'xmlhttprequest'].includes(entry.initiatorType)) return;
          var startedMs = performance.timeOrigin + entry.startTime;
          var receivedMs = startedMs + entry.duration;
          send({
            service: service(entry.name), requestStartedAt: new Date(startedMs).toISOString(),
            responseReceivedAt: new Date(receivedMs).toISOString(), durationMs: Math.round(entry.duration),
            requestMethod: 'GET', requestUrl: entry.name,
            requestHeaders: null, requestBody: null, responseStatus: null,
            responseStatusText: null, responseHeaders: null, responseBody: null,
            success: true, errorName: null,
            errorMessage: 'Browser resource timing; response details are not exposed to iframe JavaScript.'
          });
        });
      }).observe({ type: 'resource', buffered: true });
    } catch (_) {}
  }
})();
</script>`;
}
