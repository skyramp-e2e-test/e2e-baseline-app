import { test, expect, request as playwrightRequest, APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.SKYRAMP_TEST_BASE_URL || process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The version the app declares in its own package.json (repository root).
const PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf-8"),
).version;

let api: APIRequestContext;

test.beforeEach(async () => {
  // A fresh context per test, so no cookie carries over between requests unless a test sends one.
  api = await playwrightRequest.newContext({ baseURL: BASE_URL });
});

test.afterEach(async () => {
  await api.dispose();
});

async function getVersion(cookie?: string) {
  const response = await api.get("/api/health/version", {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: response.status(), contentType: response.headers()["content-type"] || "", body: await response.json() };
}

test("anonymous GET /api/health/version returns the package.json version", async () => {
  expect(PACKAGE_VERSION).toBe("1.0.0");
  const { status, contentType, body } = await getVersion();
  expect(status).toBe(200);
  expect(contentType).toContain("application/json");
  expect(typeof body.version).toBe("string");
  expect(body).toEqual({ version: PACKAGE_VERSION });
  expect(Object.keys(body)).toEqual(["version"]);
});

test("GET /api/health/version answers the same with a valid or tampered session cookie", async () => {
  const username = process.env.SKYRAMP_UI_USERNAME;
  const password = process.env.SKYRAMP_UI_PASSWORD;
  expect(username, "SKYRAMP_UI_USERNAME must be set").toBeTruthy();
  expect(password, "SKYRAMP_UI_PASSWORD must be set").toBeTruthy();

  const login = await api.post("/login", {
    form: { email: username as string, password: password as string },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  expect(login.headers()["location"]).toBe("/items");
  const setCookie = login.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value || "";
  const sessionCookie = setCookie.split(";")[0];
  expect(sessionCookie).toMatch(/^session=s%3A/);

  const anonymous = await getVersion();
  expect(anonymous.status).toBe(200);
  expect(anonymous.body).toEqual({ version: PACKAGE_VERSION });

  const signedIn = await getVersion(sessionCookie);
  expect(signedIn.status).toBe(200);
  expect(signedIn.contentType).toContain("application/json");
  expect(signedIn.body).toEqual({ version: "1.0.0" });
  expect(signedIn.body).toEqual(anonymous.body);

  const tampered = await getVersion("session=s%3Afoo.bad");
  expect(tampered.status).toBe(200);
  expect(tampered.contentType).toContain("application/json");
  expect(tampered.body).toEqual({ version: "1.0.0" });
  expect(tampered.body).toEqual(anonymous.body);
});

test("existing health checks /health and /healthz still answer ok", async () => {
  for (const route of ["/health", "/healthz"]) {
    const response = await api.get(route);
    expect(response.status(), route).toBe(200);
    expect(await response.json(), route).toEqual({ status: "ok" });
  }
});
