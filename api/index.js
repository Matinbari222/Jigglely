export const config = {
  runtime: "edge",
};

// ---------- Environment Variables ----------
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/xhttp-relay");
const RELAY_KEY = (process.env.RELAY_KEY || "").trim();
const UPSTREAM_TIMEOUT_MS = parsePositiveInt(process.env.UPSTREAM_TIMEOUT_MS, 60000, 1000);
const MAX_INFLIGHT = parsePositiveInt(process.env.MAX_INFLIGHT, 12, 1);
const FAKE_HEALTH_PATH = normalizeRelayPath(process.env.FAKE_HEALTH_PATH || "/health");
const JITTER_MS_MAX = parsePositiveInt(process.env.JITTER_MS_MAX, 0, 0);

// ---------- Constants ----------
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);

const STRIP_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded", "x-forwarded-host", "x-forwarded-proto",
  "x-forwarded-port", "x-forwarded-for", "x-real-ip",
  "x-vercel-ip", "x-vercel-proxy-signature", "x-vercel-id",
  "x-vercel-proxied", "x-vercel-deployment-url", "x-vercel-country",
  "x-forwarded-for-vercel", "cf-connecting-ip", "cf-ipcountry",
  "cf-ray", "cf-visitor", "true-client-ip", "cdn-loop", "via",
  "proxy-connection",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "server", "x-powered-by", "x-vercel-cache", "x-vercel-id",
  "x-vercel-deployment-url", "cf-cache-status", "cf-ray",
  "report-to", "nel", "access-control-allow-origin",
  "access-control-allow-credentials",
]);

const FORWARD_HEADER_PREFIXES = [
  "accept", "content-", "user-agent", "cache-control",
  "pragma", "sec-ch-", "sec-fetch-", "sec-websocket-",
  "x-", "range", "if-", "referer", "origin", "cookie",
  "dnt", "authorization",
];

// ---------- HTML Landing Page (Decoy) ----------
const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>A Man With Two Heads</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0a0a0a;
    color: #ccc;
    font-family: 'Courier New', Courier, monospace;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 2rem;
    background-image: radial-gradient(circle at 20% 20%, #1a1a1a 0%, #0a0a0a 90%);
  }
  .card {
    max-width: 600px; width: 100%;
    background: #111; border: 1px solid #2a2a2a;
    border-radius: 16px; padding: 2.5rem;
    box-shadow: 0 0 30px rgba(255,0,0,0.1);
  }
  h1 {
    font-size: 2.2rem; text-align: center;
    background: linear-gradient(135deg, #e63946, #ff4d4d);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 1.5rem; letter-spacing: 2px;
    text-shadow: 0 0 8px rgba(230,57,70,0.5);
  }
  .status-line {
    display: flex; align-items: center; gap: 10px;
    justify-content: center; margin-bottom: 2rem;
  }
  .status-dot {
    width: 12px; height: 12px;
    background: #2ecc71; border-radius: 50%;
    box-shadow: 0 0 12px #2ecc71;
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%{opacity:1; transform:scale(1);} 50%{opacity:0.5; transform:scale(1.1);} 100%{opacity:1; transform:scale(1);}
  }
  .status-text { font-size: 1rem; color: #2ecc71; }
  .quote {
    font-style: italic; text-align: center;
    padding: 1.2rem; border-left: 3px solid #e63946;
    background: rgba(230,57,70,0.05); margin: 1.5rem 0;
    color: #bbb;
  }
  .quote-author { display: block; margin-top: 0.5rem; color: #e63946; font-size: 0.9rem; }
  .info-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
    margin-top: 1.5rem; font-size: 0.9rem;
  }
  .info-item {
    background: #191919; padding: 0.8rem; border-radius: 8px;
    border: 1px solid #2a2a2a;
  }
  .info-label { color: #888; font-size: 0.7rem; text-transform: uppercase; }
  .info-value { color: #e63946; font-weight: bold; }
  .footer-text {
    text-align: center; font-size: 0.75rem; color: #555; margin-top: 2rem;
  }
</style>
</head>
<body>
<div class="card">
  <h1>A Man With Two Heads</h1>
  <div class="status-line">
    <span class="status-dot"></span>
    <span class="status-text">Operational</span>
  </div>
  <div class="quote">
    “The eternal silence of these infinite spaces frightens me.”
    <span class="quote-author">— Blaise Pascal</span>
  </div>
  <div class="info-grid">
    <div class="info-item"><span class="info-label">Project</span><br><span class="info-value">xHTTP Relay</span></div>
    <div class="info-item"><span class="info-label">Environment</span><br><span class="info-value">Edge Network</span></div>
    <div class="info-item"><span class="info-label">Node</span><br><span class="info-value" id="nodeId">EU-WEST-1</span></div>
    <div class="info-item"><span class="info-label">Visitors</span><br><span class="info-value" id="visitorCount">1,337</span></div>
  </div>
  <div class="footer-text">
    &copy; 2025 – This is a decoy page.
  </div>
</div>
<script>
  (function(){
    let c = localStorage.getItem('vCounter');
    if(!c){ c = 1337 + Math.floor(Math.random()*100); }
    c = parseInt(c) + 1;
    localStorage.setItem('vCounter', c);
    document.getElementById('visitorCount').textContent = c.toLocaleString();
    const regions = ['EU-WEST-1','US-EAST-2','AP-SOUTHEAST-1','SA-EAST-1'];
    document.getElementById('nodeId').textContent = regions[Math.floor(Math.random()*regions.length)];
  })();
</script>
</body>
</html>`;

// ---------- Helper Functions ----------
function normalizeRelayPath(rawPath) {
  if (!rawPath) return "/";
  let path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}
function parsePositiveInt(raw, fallback, min) {
  const val = Number(raw);
  if (!Number.isFinite(val) || val < min) return fallback;
  return Math.trunc(val);
}
function tryAcquireSlot() {
  if (inFlight >= MAX_INFLIGHT) return false;
  inFlight++;
  return true;
}
function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
}
function shouldForwardHeader(headerName) {
  for (const prefix of FORWARD_HEADER_PREFIXES) {
    if (headerName.startsWith(prefix)) return true;
  }
  return false;
}
function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomDelay(maxMs) {
  if (maxMs <= 0) return;
  const ms = Math.floor(Math.random() * maxMs) + 20;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- Shared State ----------
let inFlight = 0;
const SERVER_NAMES = ["nginx", "Apache/2.4.41 (Ubuntu)", "LiteSpeed", "cloudflare", "Microsoft-IIS/10.0"];
const DECOY_404_TEMPLATES = [
  "<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>",
  "<!DOCTYPE html><html><head><title>Page Not Found</title></head><body style='text-align:center;padding-top:50px;'><h2>404</h2><p>Oops! The page you're looking for doesn't exist.</p></body></html>",
  "<!DOCTYPE html><html><head><title>Error 404</title></head><body><h1>404 - Resource Not Found</h1><p>Please check the URL or contact the administrator.</p></body></html>",
];
const FAKE_HEALTH_JSON = JSON.stringify({
  status: "ok",
  uptime: Math.floor(Date.now() / 1000) % 86400,
  version: "2.1.3",
  timestamp: Date.now()
});

// ---------- Main Handler ----------
export default async function handler(req) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let slotAcquired = false;
  const url = new URL(req.url);

  // ---- 1. Landing page (root) ----
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(LANDING_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "server": randomItem(SERVER_NAMES) }
    });
  }

  // ---- 2. Fake Health Check ----
  if (url.pathname === FAKE_HEALTH_PATH) {
    const respHeaders = new Headers();
    respHeaders.set("content-type", "application/json; charset=utf-8");
    respHeaders.set("server", randomItem(SERVER_NAMES));
    return new Response(FAKE_HEALTH_JSON, { status: 200, headers: respHeaders });
  }

  // ---- 3. Validate target domain ----
  if (!TARGET_BASE) {
    return new Response(randomItem(DECOY_404_TEMPLATES), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "server": randomItem(SERVER_NAMES) }
    });
  }

  // ---- 4. Path validation (relay only on RELAY_PATH) ----
  if (!(url.pathname === RELAY_PATH || url.pathname.startsWith(`${RELAY_PATH}/`))) {
    const decoyHTML = randomItem(DECOY_404_TEMPLATES);
    return new Response(decoyHTML, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "server": randomItem(SERVER_NAMES) }
    });
  }

  // ---- 5. Method validation ----
  if (!ALLOWED_METHODS.has(req.method)) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ---- 6. Authentication (optional) ----
  if (RELAY_KEY) {
    const authToken = req.headers.get("x-relay-key") || "";
    if (authToken !== RELAY_KEY) {
      const decoyHTML = randomItem(DECOY_404_TEMPLATES);
      return new Response(decoyHTML, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "server": randomItem(SERVER_NAMES) }
      });
    }
  }

  // ---- 7. Concurrency limit ----
  if (!tryAcquireSlot()) {
    return new Response("Service Unavailable", { status: 503, headers: { "retry-after": "1" } });
  }
  slotAcquired = true;

  try {
    // Build target URL
    const targetUrl = `${TARGET_BASE}${url.pathname}${url.search}`;
    // Prepare headers
    const headers = new Headers();
    let clientIp = null;
    for (const [key, value] of req.headers) {
      const lowerKey = key.toLowerCase();
      if (STRIP_REQUEST_HEADERS.has(lowerKey)) continue;
      if (lowerKey.startsWith("x-vercel-")) continue;
      if (lowerKey.startsWith("cf-")) continue;
      if (lowerKey === "x-relay-key") continue;
      if (lowerKey === "x-real-ip" || lowerKey === "true-client-ip") {
        if (!clientIp && value) clientIp = value;
        continue;
      }
      if (!shouldForwardHeader(lowerKey)) continue;
      headers.set(key, value);
    }
    if (clientIp) {
      headers.set("x-forwarded-for", clientIp);
    }
    if (!headers.has("user-agent")) {
      headers.set("user-agent", randomItem([
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
      ]));
    }

    // Optional jitter
    if (JITTER_MS_MAX > 0) await randomDelay(JITTER_MS_MAX);

    // Upstream request
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
    const fetchOptions = {
      method: req.method,
      headers,
      redirect: "manual",
      signal: abortController.signal,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = req.body;
      fetchOptions.duplex = "half";
    }
    let upstream;
    try {
      upstream = await fetch(targetUrl, fetchOptions);
    } finally {
      clearTimeout(timeoutId);
    }

    // Build response headers (randomized)
    const responseHeaders = new Headers();
    for (const [key, value] of upstream.headers) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "transfer-encoding" || lowerKey === "connection") continue;
      if (STRIP_RESPONSE_HEADERS.has(lowerKey)) continue;
      if (lowerKey.startsWith("x-vercel-")) continue;
      if (lowerKey.startsWith("cf-")) continue;
      responseHeaders.set(key, value);
    }
    responseHeaders.set("server", randomItem(SERVER_NAMES));
    if (Math.random() > 0.3) responseHeaders.set("x-content-type-options", "nosniff");
    if (Math.random() > 0.5) responseHeaders.set("x-frame-options", "SAMEORIGIN");
    if (Math.random() > 0.7) responseHeaders.set("x-xss-protection", "1; mode=block");

    if (process.env.ENABLE_LOGGING !== "0") {
      console.log(`[relay] ${requestId} ${req.method} ${url.pathname} → ${upstream.status} (${Date.now() - startedAt}ms)`);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (process.env.ENABLE_LOGGING !== "0") {
      console.error(`[relay] ${requestId} error: ${error.message}`);
    }
    if (error.name === "AbortError") {
      return new Response("Gateway Timeout", { status: 504 });
    }
    return new Response("Bad Gateway", { status: 502 });
  } finally {
    if (slotAcquired) releaseSlot();
  }
}
