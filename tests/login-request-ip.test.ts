import { expect, it } from "vitest";
import { getLoginRequestIp } from "../src/lib/login-request-ip.server";

it("prefers bounded server forwarding headers and rejects non-IP values", () => {
  expect(
    getLoginRequestIp(
      new Headers({
        "x-vercel-forwarded-for": "203.0.113.8",
        "x-forwarded-for": "198.51.100.9, 10.0.0.2",
        "x-real-ip": "192.0.2.7",
      }),
    ),
  ).toBe("203.0.113.8");
  expect(getLoginRequestIp(new Headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.2" }))).toBe(
    "198.51.100.9",
  );
  expect(getLoginRequestIp(new Headers({ "x-real-ip": "2001:db8::7" }))).toBe("2001:db8::7");
  expect(getLoginRequestIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.800" }))).toBe(
    "unknown",
  );
});
