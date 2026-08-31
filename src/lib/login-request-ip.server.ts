import { isIP } from "node:net";

const MAX_IP_LENGTH = 45;

// getLoginRateLimitBuckets was removed here (user decision, 2026-08-31:
// "Hilangkan Rate Limiting !") along with the whole tenant/restaurant-code
// login rate-limiting subsystem (tenant_login_rate_limits /
// tenant_global_login_rate_limits). getLoginRequestIp is KEPT: it is still
// used by the separate, untouched owner-login-rate-limit.server.ts (Super
// Admin dashboard login rate limiting, out of scope for this change).
export function getLoginRequestIp(headers: Headers) {
  const candidate =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    headers.get("x-real-ip") ??
    "";
  const ip = candidate.trim();
  return ip.length <= MAX_IP_LENGTH && isIP(ip) ? ip : "unknown";
}
