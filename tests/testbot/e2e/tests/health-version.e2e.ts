import { test, expect, request as playwrightRequest, APIRequestContext, APIResponse } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://127.0.0.1:3000";

// The version the app should report: the "version" field of the repository's package.json.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "..", "package.json"), "utf8"),
).version;

async function newClient(extraHTTPHeaders?: Record<string, string>): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders });
}

async function expectJson(response: APIResponse, status: number, body: unknown) {
  expect(response.status()).toBe(status);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toStrictEqual(body);
}

test.describe("GET /api/health/version", () => {
  test("anonymous request returns the version from package.json", async () => {
    expect(PACKAGE_VERSION).toBe("1.0.0");
    const client = await newClient();
    try {
      const response = await client.get("/api/health/version");
      await expectJson(response, 200, { version: PACKAGE_VERSION });
      const body = await response.json();
      expect(Object.keys(body)).toEqual(["version"]);
      expect(typeof body.version).toBe("string");
      expect(body.version).toBe("1.0.0");
    } finally {
      await client.dispose();
    }
  });

  test("signed-in user and an invalid session cookie get the same answer as anonymous", async () => {
    const username = process.env.SKYRAMP_UI_USERNAME;
    const password = process.env.SKYRAMP_UI_PASSWORD;
    if (!username || !password) throw new Error("SKYRAMP_UI_USERNAME and SKYRAMP_UI_PASSWORD must be set to sign in");

    const anonymous = await newClient();
    const signedIn = await newClient();
    const tampered = await newClient({ Cookie: "session=s%3Abogus.sig" });
    try {
      const anonymousResponse = await anonymous.get("/api/health/version");
      await expectJson(anonymousResponse, 200, { version: "1.0.0" });
      const anonymousBody = await anonymousResponse.json();

      const login = await signedIn.post("/login", { form: { email: username, password }, maxRedirects: 0 });
      expect(login.status()).toBe(303);
      expect(login.headers()["set-cookie"]).toContain("session=");
      const me = await signedIn.get("/api/me");
      expect(me.status()).toBe(200);

      const signedInResponse = await signedIn.get("/api/health/version");
      await expectJson(signedInResponse, 200, { version: "1.0.0" });
      expect(await signedInResponse.json()).toStrictEqual(anonymousBody);

      const tamperedResponse = await tampered.get("/api/health/version");
      await expectJson(tamperedResponse, 200, { version: "1.0.0" });
      expect(await tamperedResponse.json()).toStrictEqual(anonymousBody);
    } finally {
      await Promise.all([anonymous.dispose(), signedIn.dispose(), tampered.dispose()]);
    }
  });

  test("repeated requests and a query string return the same version", async () => {
    const client = await newClient();
    try {
      const first = await client.get("/api/health/version");
      await expectJson(first, 200, { version: "1.0.0" });
      const second = await client.get("/api/health/version");
      await expectJson(second, 200, { version: "1.0.0" });
      expect(await second.json()).toStrictEqual(await first.json());
      const withQuery = await client.get("/api/health/version?x=1");
      await expectJson(withQuery, 200, { version: "1.0.0" });
    } finally {
      await client.dispose();
    }
  });

  test("POST is not a route and does not change the reported version", async () => {
    const client = await newClient();
    try {
      const post = await client.post("/api/health/version", { data: { version: "9" } });
      await expectJson(post, 404, { error: "Not found" });
      const after = await client.get("/api/health/version");
      await expectJson(after, 200, { version: "1.0.0" });
    } finally {
      await client.dispose();
    }
  });
});

test.describe("health routes alongside /api/health/version", () => {
  test("GET /health and GET /healthz still answer ok", async () => {
    const client = await newClient();
    try {
      await expectJson(await client.get("/health"), 200, { status: "ok" });
      await expectJson(await client.get("/healthz"), 200, { status: "ok" });
    } finally {
      await client.dispose();
    }
  });
});
