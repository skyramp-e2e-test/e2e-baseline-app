// Contract tests for GET /api/health/version: the app's version from package.json,
// answered without sign-in like the other health checks.
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { SkyrampClient } from "@skyramp/skyramp";
import { readFileSync } from "fs";
import * as path from "path";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";
const ENDPOINT = "/api/health/version";
const EXPECTED_VERSION = "1.0.0";

// The app's own package.json, at the repository root.
const APP_PACKAGE_JSON = path.resolve(__dirname, "..", "..", "..", "..", "package.json");

async function getVersion(cookies?: { [name: string]: string }) {
  const client = new SkyrampClient();
  return client.sendRequest({
    url: BASE_URL,
    path: ENDPOINT,
    method: "GET",
    cookies,
  });
}

// Signs in through the login form and returns the signed session cookie's value.
async function signIn(): Promise<string> {
  const context = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await context.post("/login", {
      form: {
        email: process.env.SKYRAMP_UI_USERNAME as string,
        password: process.env.SKYRAMP_UI_PASSWORD as string,
      },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    expect(res.headers()["location"]).toBe("/items");
    const session = (await context.storageState()).cookies.find((c) => c.name === "session");
    expect(session, "sign-in sets a session cookie").toBeDefined();
    return (session as { value: string }).value;
  } finally {
    await context.dispose();
  }
}

test.describe("GET /api/health/version", () => {
  test("answers an anonymous request with 200 and a JSON body carrying the version", async () => {
    const response = await getVersion();
    expect(response.statusCode).toBe(200);
    const headers = Object.fromEntries(
      Object.entries(response.responseHeaders).map(([k, v]) => [k.toLowerCase(), String(v)])
    );
    expect(headers["content-type"]).toMatch(/^application\/json/);
    const body = JSON.parse(response.responseBody);
    expect(typeof body).toBe("object");
    expect(Array.isArray(body)).toBe(false);
    expect(body).toHaveProperty("version");
  });

  test("reports exactly the version in package.json and nothing else", async () => {
    const pkgVersion = JSON.parse(readFileSync(APP_PACKAGE_JSON, "utf8")).version;
    expect(pkgVersion).toBe(EXPECTED_VERSION);

    const response = await getVersion();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.responseBody)).toStrictEqual({ version: pkgVersion });
  });

  test("answers the same whether signed in, anonymous, or with a tampered session cookie", async () => {
    const anonymous = await getVersion();
    expect(anonymous.statusCode).toBe(200);
    expect(JSON.parse(anonymous.responseBody)).toStrictEqual({ version: EXPECTED_VERSION });

    const session = await signIn();
    const signedIn = await getVersion({ session });
    expect(signedIn.statusCode).toBe(200);
    expect(JSON.parse(signedIn.responseBody)).toStrictEqual({ version: EXPECTED_VERSION });

    const tampered = await getVersion({ session: "garbage" });
    expect(tampered.statusCode).toBe(200);
    expect(JSON.parse(tampered.responseBody)).toStrictEqual({ version: EXPECTED_VERSION });
  });
});
