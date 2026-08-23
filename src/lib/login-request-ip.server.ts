import { isIP } from "node:net";

const MAX_IP_LENGTH = 45;

export function getLoginRequestIp(headers: Headers) {
  const candidate =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    headers.get("x-real-ip") ??
    "";
  const ip = candidate.trim();
  return ip.length <= MAX_IP_LENGTH && isIP(ip) ? ip : "unknown";
}

export function getLoginRateLimitBuckets(
  headers: Headers,
  clientKey: string,
  hash: (value: string) => string,
) {
  return { clientKeyHash: hash(clientKey), ipKeyHash: hash(getLoginRequestIp(headers)) };
}
