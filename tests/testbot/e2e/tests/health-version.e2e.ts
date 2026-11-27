import { test, expect, APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://127.0.0.1:3000";

// The version the app reports must be the one in the repository's package.json.
const PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "package.json"), "utf8"),
).version;

async function getVersion(request: APIRequestContext, headers: Record<string, string> = {}) {
  const response = await request.get(`${BASE_URL}/api/health/version`, { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  return response.json();
}

test.describe("GET /api/health/version", () => {
  test("reports the package.json version as the only field, the same on a repeat request", async ({ request }) => {
    expect(PACKAGE_VERSION).toBe("1.0.0");

    const first = await getVersion(request);
    expect(first).toStrictEqual({ version: PACKAGE_VERSION });
    expect(typeof first.version).toBe("string");

    const second = await getVersion(request);
    expect(second).toStrictEqual({ version: PACKAGE_VERSION });
  });

  test("is public: answers the same with no cookie, a garbage session cookie, and a signed-in session", async ({ playwright }) => {
    // The account the app seeds on start; the run and CI supply its login through the environment.
    const USERNAME = process.env.SKYRAMP_UI_USERNAME as string;
    const PASSWORD = process.env.SKYRAMP_UI_PASSWORD as string;
    expect(USERNAME, "SKYRAMP_UI_USERNAME must be set").toBeTruthy();
    expect(PASSWORD, "SKYRAMP_UI_PASSWORD must be set").toBeTruthy();

    const request = await playwright.request.newContext();
    try {
      // Contrast: a route that needs sign-in refuses a request without a session.
      const me = await request.get(`${BASE_URL}/api/me`);
      expect(me.status()).toBe(401);

      expect(await getVersion(request)).toStrictEqual({ version: PACKAGE_VERSION });
      expect(await getVersion(request, { Cookie: "session=garbage" })).toStrictEqual({ version: PACKAGE_VERSION });

      const login = await request.post(`${BASE_URL}/login`, {
        form: { email: USERNAME, password: PASSWORD },
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

      const signedIn = await request.get(`${BASE_URL}/api/me`, { headers: { Cookie: sessionCookie! } });
      expect(signedIn.status()).toBe(200);
      expect(await signedIn.json()).toStrictEqual({ email: USERNAME.trim().toLowerCase() });

      expect(await getVersion(request, { Cookie: sessionCookie! })).toStrictEqual({ version: PACKAGE_VERSION });
    } finally {
      await request.dispose();
    }
  });
});

test.describe("existing routes after the version endpoint was added", () => {
  test("health checks, the item list and the not-found fallback answer as before", async ({ request }) => {
    for (const route of ["/health", "/healthz"]) {
      const response = await request.get(`${BASE_URL}${route}`);
      expect(response.status(), route).toBe(200);
      expect(await response.json(), route).toStrictEqual({ status: "ok" });
    }

    const items = await request.get(`${BASE_URL}/api/items`);
    expect(items.status()).toBe(200);
    expect(items.headers()["content-type"]).toContain("application/json");
    expect(Array.isArray(await items.json())).toBe(true);

    const unknown = await request.get(`${BASE_URL}/api/nope`);
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toStrictEqual({ error: "Not found" });
  });
});
