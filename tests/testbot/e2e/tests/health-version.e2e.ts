// Backend API tests for GET /api/health/version and the health checks beside it.
import { test, expect, request as playwrightRequest, APIRequestContext } from "@playwright/test";
import { readFileSync } from "fs";
import * as path from "path";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The version the app should report: the one in the app's own package.json.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "..", "..", "..", "package.json"), "utf8"),
).version;

// The account the app's database setup seeds (src/db.js).
const SEEDED_USER = { email: "test@example.com", password: "password123" };

let api: APIRequestContext;

test.beforeEach(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE_URL });
});

test.afterEach(async () => {
  await api.dispose();
});

test("version endpoint returns the package.json version", async () => {
  expect(PACKAGE_VERSION).toBe("1.0.0");

  const response = await api.get("/api/health/version");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({ version: PACKAGE_VERSION });
});

test("version endpoint answers the same without and with a session", async () => {
  const anonymous = await api.get("/api/health/version");
  expect(anonymous.status()).toBe(200);
  const anonymousBody = await anonymous.json();
  expect(anonymousBody).toEqual({ version: "1.0.0" });

  const signedIn = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const login = await signedIn.post("/login", { form: SEEDED_USER, maxRedirects: 0 });
    expect(login.status()).toBe(303);
    expect(login.headers()["location"]).toBe("/items");
    const cookies = await signedIn.storageState();
    expect(cookies.cookies.map((c) => c.name)).toContain("session");

    const withSession = await signedIn.get("/api/health/version");
    expect(withSession.status()).toBe(200);
    expect(await withSession.json()).toEqual(anonymousBody);
  } finally {
    await signedIn.dispose();
  }
});

test("version endpoint body has only a non-empty version string", async () => {
  const response = await api.get("/api/health/version");

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["version"]);
  expect(typeof body.version).toBe("string");
  expect(body.version.length).toBeGreaterThan(0);
  expect(body.version).toBe("1.0.0");
});

test("health and healthz still answer ok", async () => {
  for (const route of ["/health", "/healthz"]) {
    const response = await api.get(route);
    expect(response.status(), route).toBe(200);
    expect(await response.json(), route).toEqual({ status: "ok" });
  }
});
