// k6 responsiveness check for the hub portal.
//
// Measures TTFB / total latency and error rate for the paths that were timing
// out in production (hub team page, cycle page, status poll) against any
// deployment, so before/after comparisons are apples-to-apples.
//
// Usage (needs a logged-in wos-session cookie from the browser; the preview and
// production deployments share WORKOS_COOKIE_PASSWORD so one cookie works on both):
//
//   k6 run scripts/load/hub-responsiveness.js \
//     -e BASE_URL=https://pulse.plusplusminus.co.za \
//     -e COOKIE="wos-session=..." \
//     -e HUB_SLUG=54-collective -e TEAM_KEY=542 -e HUB_ID=<uuid> \
//     -e VUS=10 -e DURATION=60s
//
// Optional: -e CYCLE_ID=<linear cycle id> to include a cycle detail page.
//
// Thresholds are deliberately strict: the point is to see p95 of the full page
// render, not to pass.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://pulse.plusplusminus.co.za";
const COOKIE = __ENV.COOKIE || "";
const HUB_SLUG = __ENV.HUB_SLUG || "54-collective";
const TEAM_KEY = __ENV.TEAM_KEY || "542";
const HUB_ID = __ENV.HUB_ID || "";
const CYCLE_ID = __ENV.CYCLE_ID || "";

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "60s",
  thresholds: {
    "http_req_duration{page:team}": ["p(95)<3000"],
    "http_req_duration{page:cycle}": ["p(95)<3000"],
    "http_req_duration{page:status}": ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

const ttfbTeam = new Trend("ttfb_team_page", true);
const ttfbCycle = new Trend("ttfb_cycle_page", true);
const ttfbStatus = new Trend("ttfb_status", true);
const timeouts = new Rate("timeouts_or_5xx");

const params = (tag) => ({
  headers: { Cookie: COOKIE, Accept: "text/html,application/json" },
  redirects: 0,
  tags: { page: tag },
  timeout: "30s",
});

function record(res, trend) {
  trend.add(res.timings.waiting);
  timeouts.add(res.status === 0 || res.status >= 500);
  check(res, {
    "status 200": (r) => r.status === 200,
    "not redirected to login": (r) => r.status !== 307 && r.status !== 302,
  });
}

export default function () {
  const team = http.get(`${BASE_URL}/hub/${HUB_SLUG}/${TEAM_KEY}`, params("team"));
  record(team, ttfbTeam);

  if (CYCLE_ID) {
    const cycle = http.get(
      `${BASE_URL}/hub/${HUB_SLUG}/${TEAM_KEY}/cycles/${CYCLE_ID}`,
      params("cycle")
    );
    record(cycle, ttfbCycle);
  }

  if (HUB_ID) {
    const status = http.get(`${BASE_URL}/api/hub/${HUB_ID}/status`, params("status"));
    if (status.status === 404) {
      // Older deployment without /status: fall back to the two legacy pollers.
      const a = http.get(`${BASE_URL}/api/hub/${HUB_ID}/notifications/unread-count`, params("status"));
      const b = http.get(`${BASE_URL}/api/hub/${HUB_ID}/last-sync`, params("status"));
      record(a, ttfbStatus);
      record(b, ttfbStatus);
    } else {
      record(status, ttfbStatus);
    }
  }

  sleep(1);
}

export function handleSummary(data) {
  const m = data.metrics;
  const pick = (name) => {
    const v = m[name] && m[name].values;
    if (!v) return null;
    return {
      p50: Math.round(v.med || v["p(50)"] || 0),
      p95: Math.round(v["p(95)"] || 0),
      p99: Math.round(v["p(99)"] || 0),
      max: Math.round(v.max || 0),
      count: v.count,
    };
  };
  const summary = {
    base_url: BASE_URL,
    vus: options.vus,
    duration: options.duration,
    team_page_ttfb_ms: pick("ttfb_team_page"),
    cycle_page_ttfb_ms: pick("ttfb_cycle_page"),
    status_ttfb_ms: pick("ttfb_status"),
    http_req_failed_rate: m.http_req_failed ? m.http_req_failed.values.rate : null,
    timeouts_or_5xx_rate: m.timeouts_or_5xx ? m.timeouts_or_5xx.values.rate : null,
  };
  return {
    stdout: JSON.stringify(summary, null, 2) + "\n",
    [`k6-summary-${Date.now()}.json`]: JSON.stringify({ summary, raw: data }, null, 2),
  };
}
