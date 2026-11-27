// GET /api/health/version: the app's package.json version, public like /health and /healthz.
import { readFileSync } from "fs";
import { join } from "path";
import { test, expect } from "@playwright/test";
import { SkyrampClient } from "@skyramp/skyramp";

const BASE_URL =
  process.env.SKYRAMP_TEST_BASE_URL || process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The version the app must report: the "version" of the app's own package.json, read at test time.
const APP_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "..", "package.json"), "utf8")
).version;

function contentType(headers: { [name: string]: string } | undefined): string {
  const entry = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === "content-type");
  return entry ? entry[1] : "";
}

test.describe("GET /api/health/version", () => {
  test("anonymous request returns exactly the package.json version as JSON", async () => {
    const client = new SkyrampClient();
    const response = await client.sendRequest({
      url: BASE_URL,
      path: "/api/health/version",
      method: "GET",
    });

    expect(response.statusCode).toBe(200);
    expect(contentType(response.responseHeaders)).toMatch(/^application\/json/);
    const body = JSON.parse(response.responseBody as string);
    expect(Object.keys(body)).toEqual(["version"]);
    expect(typeof body.version).toBe("string");
    expect(body).toEqual({ version: APP_VERSION });
  });

  test("answers the same with a signed-in session and with a tampered session cookie", async () => {
    const client = new SkyrampClient();

    const anonymous = await client.sendRequest({ url: BASE_URL, path: "/api/health/version", method: "GET" });
    expect(anonymous.statusCode).toBe(200);
    expect(JSON.parse(anonymous.responseBody as string)).toEqual({ version: APP_VERSION });

    const login = await client.sendRequest({
      url: BASE_URL,
      path: "/login",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      formParams: {
        email: process.env.SKYRAMP_UI_USERNAME as string,
        password: process.env.SKYRAMP_UI_PASSWORD as string,
      },
    });
    expect(login.statusCode).toBe(303);
    expect(login.responseHeaders?.Location ?? login.responseHeaders?.location).toBe("/items");
    const session = login.cookies?.session;
    expect(session).toBeTruthy();

    // The cookie really is a signed-in session.
    const me = await client.sendRequest({
      url: BASE_URL,
      path: "/api/me",
      method: "GET",
      cookies: { session: session as string },
    });
    expect(me.statusCode).toBe(200);

    const signedIn = await client.sendRequest({
      url: BASE_URL,
      path: "/api/health/version",
      method: "GET",
      cookies: { session: session as string },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(contentType(signedIn.responseHeaders)).toMatch(/^application\/json/);
    expect(JSON.parse(signedIn.responseBody as string)).toEqual({ version: APP_VERSION });

    const tampered = await client.sendRequest({
      url: BASE_URL,
      path: "/api/health/version",
      method: "GET",
      cookies: { session: "garbage" },
    });
    expect(tampered.statusCode).toBe(200);
    expect(contentType(tampered.responseHeaders)).toMatch(/^application\/json/);
    expect(JSON.parse(tampered.responseBody as string)).toEqual({ version: APP_VERSION });
  });
});

test.describe("health routes beside the version endpoint", () => {
  test("GET /health and GET /healthz still answer 200 with status ok", async () => {
    const client = new SkyrampClient();
    for (const path of ["/health", "/healthz"]) {
      const response = await client.sendRequest({ url: BASE_URL, path, method: "GET" });
      expect(response.statusCode, path).toBe(200);
      expect(JSON.parse(response.responseBody as string), path).toEqual({ status: "ok" });
    }
  });
});
