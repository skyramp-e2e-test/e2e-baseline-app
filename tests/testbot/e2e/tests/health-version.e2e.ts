import { readFileSync } from "fs";
import { resolve } from "path";
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SKYRAMP_TEST_BASE_URL || process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The version the app should report is the one in the app's own package.json.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "..", "..", "package.json"), "utf-8"),
).version;

test.describe("GET /api/health/version", () => {
  test("returns 200 with the package.json version and no session", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health/version`);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({ version: "1.0.0" });
    expect(typeof body.version).toBe("string");
    expect(body.version).toBe(PACKAGE_VERSION);
  });

  test("answers the same with a tampered session cookie", async ({ request }) => {
    const withoutCookie = await request.get(`${BASE_URL}/api/health/version`);
    const withBadCookie = await request.get(`${BASE_URL}/api/health/version`, {
      headers: { Cookie: "session=s%3Abogus.invalidsig" },
    });

    expect(withBadCookie.status()).toBe(200);
    const body = await withBadCookie.json();
    expect(body).toEqual({ version: "1.0.0" });
    expect(body).toEqual(await withoutCookie.json());
  });
});

test.describe("existing health routes", () => {
  for (const route of ["/health", "/healthz"]) {
    test(`GET ${route} still returns 200 ok`, async ({ request }) => {
      const response = await request.get(`${BASE_URL}${route}`);

      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    });
  }
});
