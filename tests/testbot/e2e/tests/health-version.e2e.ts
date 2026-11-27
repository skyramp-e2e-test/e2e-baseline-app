import { test, expect, APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The version the app should report: read from the app's own package.json, never hard-coded.
const PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "package.json"), "utf-8"),
).version;

async function getVersion(request: APIRequestContext, cookie?: string) {
  const response = await request.get(`${APP_URL}/api/health/version`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/json/);
  return response.json();
}

test.describe("GET /api/health/version", () => {
  test("returns the version from package.json as JSON, the same on repeated requests", async ({ request }) => {
    expect(typeof PACKAGE_VERSION).toBe("string");
    expect(PACKAGE_VERSION).not.toBe("");

    const first = await getVersion(request);
    expect(first).toStrictEqual({ version: PACKAGE_VERSION });
    expect(Object.keys(first)).toEqual(["version"]);

    const second = await getVersion(request);
    expect(second).toStrictEqual({ version: PACKAGE_VERSION });
  });

  test("needs no sign-in and answers the same for anonymous, tampered-cookie and signed-in callers", async ({ playwright }) => {
    const request = await playwright.request.newContext();
    try {
      const anonymous = await getVersion(request);
      expect(anonymous).toStrictEqual({ version: PACKAGE_VERSION });

      const tampered = await getVersion(request, "session=s%3Ax.bad");
      expect(tampered).toStrictEqual({ version: PACKAGE_VERSION });

      const login = await request.post(`${APP_URL}/login`, {
        form: { email: process.env.SKYRAMP_UI_USERNAME!, password: process.env.SKYRAMP_UI_PASSWORD! },
        maxRedirects: 0,
      });
      expect(login.status()).toBe(303);
      expect(login.headers()["location"]).toBe("/items");
      const sessionCookie = login
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value.split(";")[0])
        .find((c) => c.startsWith("session="));
      expect(sessionCookie).toBeDefined();

      // The cookie is a valid session: /api/me knows the user.
      const me = await request.get(`${APP_URL}/api/me`, { headers: { Cookie: sessionCookie! } });
      expect(me.status()).toBe(200);

      const signedIn = await getVersion(request, sessionCookie);
      expect(signedIn).toStrictEqual({ version: PACKAGE_VERSION });
    } finally {
      await request.dispose();
    }
  });
});

test.describe("existing health checks and API after the version route was added", () => {
  test("health checks, items list and unknown-path 404 still answer as before", async ({ request }) => {
    for (const route of ["/health", "/healthz"]) {
      const response = await request.get(`${APP_URL}${route}`);
      expect(response.status(), route).toBe(200);
      expect(await response.json(), route).toStrictEqual({ status: "ok" });
    }

    const items = await request.get(`${APP_URL}/api/items`);
    expect(items.status()).toBe(200);
    expect(items.headers()["content-type"]).toMatch(/^application\/json/);
    expect(Array.isArray(await items.json())).toBe(true);

    const unknown = await request.get(`${APP_URL}/api/health/other`);
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toStrictEqual({ error: "Not found" });
  });
});
