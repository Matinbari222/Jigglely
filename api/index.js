export const config = {
  runtime: "edge",
};

// --- Environment Variables ---
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/xhttp-relay");
const RELAY_KEY = (process.env.RELAY_KEY || "").trim();
const UPSTREAM_TIMEOUT_MS = parsePositiveInt(process.env.UPSTREAM_TIMEOUT_MS, 60000, 1000);
const MAX_INFLIGHT = parsePositiveInt(process.env.MAX_INFLIGHT, 12, 1);
const FAKE_HEALTH_PATH = normalizeRelayPath(process.env.FAKE_HEALTH_PATH || "/health");
const JITTER_MS_MAX = parsePositiveInt(process.env.JITTER_MS_MAX, 0, 0); // پیش‌فرض غیرفعال

// --- Method Allowlist ---
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);

// --- Strip Headers (Incoming) ---
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

// --- Strip Headers (Response from Upstream) ---
const STRIP_RESPONSE_HEADERS = new Set([
  "server", "x-powered-by", "x-vercel-cache", "x-vercel-id",
  "x-vercel-deployment-url", "cf-cache-status", "cf-ray",
  "report-to", "nel", "access-control-allow-origin",
  "access-control-allow-credentials",
]);

// --- Forwarded Header Whitelist ---
const FORWARD_HEADER_PREFIXES = [
  "accept", "content-", "user-agent", "cache-control",
  "pragma", "sec-ch-", "sec-fetch-", "sec-websocket-",
  "x-", "range", "if-", "referer", "origin", "cookie",
  "dnt", "authorization",
];

// --- Concurrency ---
let inFlight = 0;

// --- Decoy 404 Templates (Randomly Chosen) ---
const DECOY_404_TEMPLATES = [
  "<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>",
  "<!DOCTYPE html><html><head><title>Page Not Found</title></head><body style='text-align:center;padding-top:50px;'><h2>404</h2><p>Oops! The page you're looking for doesn't exist.</p></body></html>",
  "<!DOCTYPE html><html><head><title>Error 404</title></head><body><h1>404 - Resource Not Found</h1><p>Please check the URL or contact the administrator.</p></body></html>",
  "<html><head><title>Not Found</title></head><body><center><h1>404</h1><p>Nothing to see here.</p></center></body></html>",
  "<!DOCTYPE html><html><head><meta charset='utf-8'><title>404</title></head><body><h1>File Not Found</h1></body></html>"
];

// --- Fake Health Check Response ---
const FAKE_HEALTH_JSON = JSON.stringify({
  status: "ok",
  uptime: Math.floor(Date.now() / 1000) % 86400, // fake uptime
  version: "2.1.3",
  timestamp: Date.now()
});

// --- Server Name Pool ---
const SERVER_NAMES = ["nginx", "Apache/2.4.41 (Ubuntu)", "LiteSpeed", "cloudflare", "Microsoft-IIS/10.0"];

// --- Random Item from Array ---
function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Delay (Jitter) - safe ---
function randomDelay(maxMs) {
  if (maxMs <= 0) return;
  const ms = Math.floor(Math.random() * maxMs) + 20;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Helper Functions ---
function shouldForwardHeader(headerName) {
  for (const prefix of FORWARD_HEADER_PREFIXES) {
    if (headerName.startsWith(prefix)) return true;
  }
  return false;
}

function isAllowedRelayPath(pathname) {
  return pathname === RELAY_PATH || pathname.startsWith(`${RELAY_PATH}/`);
}

function normalizeRelayPath(rawPath) {
  if (!rawPath) return "/";
  let path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

function parsePositiveInt(rawValue, fallbackValue, minValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return fallbackValue;
  if (value < minValue) return fallbackValue;
  return Math.trunc(value);
}

function tryAcquireSlot() {
  if (inFlight >= MAX_INFLIGHT) return false;
  inFlight++;
  return true;
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
}

// --- Main Handler ---
export default async function handler(req) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  let slotAcquired = false;

  const url = new URL(req.url);

  // 1. Fake Health Check Endpoint (safe)
  if (url.pathname === FAKE_HEALTH_PATH) {
    const respHeaders = new Headers();
    respHeaders.set("content-type", "application/json; charset=utf-8");
    respHeaders.set("server", randomItem(SERVER_NAMES));
    if (Math.random() > 0.5) respHeaders.set("x-content-type-options", "nosniff");
    if (Math.random() > 0.7) respHeaders.set("x-frame-options", "DENY");
    return new Response(FAKE_HEALTH_JSON, {
      status: 200,
      headers: respHeaders,
    });
  }

  // 2. Validation (missing target domain)
  if (!TARGET_BASE) {
    return new Response(randomItem(DECOY_404_TEMPLATES), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "server": randomItem(SERVER_NAMES) }
    });
  }

  // 3. Path Validation (relay only on designated path)
  if (!isAllowedRelayPath(url.pathname)) {
    const decoyHTML = randomItem(DECOY_404_TEMPLATES);
    return new Response(decoyHTML, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "server": randomItem(SERVER_NAMES) }
    });
  }

  // 4. Method Validation
  if (!ALLOWED_METHODS.has(req.method)) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 5. Authentication (optional)
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

  // 6. Concurrency Limit
  if (!tryAcquireSlot()) {
    return new Response("Service Unavailable", {
      status: 503,
      headers: { "retry-after": "1" }
    });
  }
  slotAcquired = true;

  try {
    // --- Build Target URL ---
    const targetUrl = `${TARGET_BASE}${url.pathname}${url.search}`;

    // --- Filter Headers ---
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

    // If User-Agent is missing, add a random one (optional, but safe for Xray)
    if (!headers.has("user-agent")) {
      headers.set("user-agent", randomItem([
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ]));
    }

    // --- Optional Timing Jitter (disabled by default) ---
    if (JITTER_MS_MAX > 0) {
      await randomDelay(JITTER_MS_MAX);
    }

    // --- Upstream Fetch ---
    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";
    
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
    
    const fetchOptions = {
      method,
      headers,
      redirect: "manual",
      signal: abortController.signal,
    };
    
    if (hasBody) {
      fetchOptions.body = req.body;
      fetchOptions.duplex = "half";
    }
    
    let upstream;
    try {
      upstream = await fetch(targetUrl, fetchOptions);
    } finally {
      clearTimeout(timeoutId);
    }
    
    // --- Build Response with Random Headers ---
    const responseHeaders = new Headers();
    
    for (const [key, value] of upstream.headers) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "transfer-encoding" || lowerKey === "connection") continue;
      if (STRIP_RESPONSE_HEADERS.has(lowerKey)) continue;
      if (lowerKey.startsWith("x-vercel-")) continue;
      if (lowerKey.startsWith("cf-")) continue;
      responseHeaders.set(key, value);
    }
    
    // Random server name (does not affect Xray protocol)
    responseHeaders.set("server", randomItem(SERVER_NAMES));
    
    // Random security headers (harmless)
    if (Math.random() > 0.3) responseHeaders.set("x-content-type-options", "nosniff");
    if (Math.random() > 0.5) responseHeaders.set("x-frame-options", "SAMEORIGIN");
    if (Math.random() > 0.7) responseHeaders.set("x-xss-protection", "1; mode=block");
    if (Math.random() > 0.6) responseHeaders.set("permissions-policy", "geolocation=()");
    
    if (process.env.ENABLE_LOGGING !== "0") {
      const durationMs = Date.now() - startedAt;
      console.log(`[relay] ${requestId} ${method} ${url.pathname} → ${upstream.status} (${durationMs}ms)`);
    }
    
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
    
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    
    if (error.name === "AbortError") {
      if (process.env.ENABLE_LOGGING !== "0") {
        console.error(`[relay] ${requestId} timeout after ${durationMs}ms`);
      }
      return new Response("Gateway Timeout", { status: 504 });
    }
    
    if (process.env.ENABLE_LOGGING !== "0") {
      console.error(`[relay] ${requestId} error: ${error.message}`);
    }
    return new Response("Bad Gateway", { status: 502 });
    
  } finally {
    if (slotAcquired) releaseSlot();
  }
}