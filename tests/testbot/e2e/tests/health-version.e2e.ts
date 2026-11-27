// GET /api/health/version: a public health route answering the app's package.json version.
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { SkyrampClient } from "@skyramp/skyramp";
import { readFileSync } from "fs";
import * as path from "path";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The version the app should report: the one in the checkout's package.json.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf8"),
).version;

async function getVersion(client: SkyrampClient, cookies?: { [name: string]: string }) {
  return client.sendRequest({
    url: BASE_URL,
    path: "/api/health/version",
    method: "GET",
    cookies,
  });
}

// Signs in through the login form and returns the signed session cookie the app sets.
async function signIn(): Promise<{ [name: string]: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/login", {
      form: { email: process.env.SKYRAMP_UI_USERNAME!, password: process.env.SKYRAMP_UI_PASSWORD! },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    expect(res.headers()["location"]).toBe("/items");
    const session = (await ctx.storageState()).cookies.find((c) => c.name === "session");
    expect(session, "login sets the session cookie").toBeTruthy();
    return { session: session!.value };
  } finally {
    await ctx.dispose();
  }
}

test.describe("GET /api/health/version", () => {
  test("anonymous request answers 200 with the package.json version as JSON", async () => {
    expect(PACKAGE_VERSION).toBe("1.0.0");
    const client = new SkyrampClient();
    const response = await getVersion(client);

    expect(response.statusCode).toBe(200);
    expect(response.responseHeaders["Content-Type"] ?? response.responseHeaders["content-type"]).toMatch(
      /^application\/json/,
    );
    const body = JSON.parse(response.responseBody);
    expect(typeof body.version).toBe("string");
    expect(body.version).toBe(PACKAGE_VERSION);
    expect(body.version).toBe("1.0.0");
  });

  test("signed-in request answers the same as an anonymous one", async () => {
    const cookies = await signIn();
    const client = new SkyrampClient();

    const signedIn = await getVersion(client, cookies);
    const anonymous = await getVersion(client);

    expect(signedIn.statusCode).toBe(200);
    expect(anonymous.statusCode).toBe(200);
    expect(JSON.parse(signedIn.responseBody)).toEqual({ version: "1.0.0" });
    expect(JSON.parse(signedIn.responseBody)).toEqual(JSON.parse(anonymous.responseBody));
  });

  test("body carries only the version field", async () => {
    const client = new SkyrampClient();
    const response = await getVersion(client);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.responseBody);
    expect(Object.keys(body)).toEqual(["version"]);
    expect(body).toEqual({ version: PACKAGE_VERSION });
  });
});
