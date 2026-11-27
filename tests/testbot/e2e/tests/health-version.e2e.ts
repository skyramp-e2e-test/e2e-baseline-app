import { test, expect, APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";
const VERSION_PATH = "/api/health/version";

// The version the app should report: package.json at the revision under test.
const PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "package.json"), "utf8"),
).version;

async function signIn(request: APIRequestContext): Promise<string> {
  const email = process.env.SKYRAMP_UI_USERNAME;
  const password = process.env.SKYRAMP_UI_PASSWORD;
  if (!email || !password) throw new Error("SKYRAMP_UI_USERNAME and SKYRAMP_UI_PASSWORD must be set to sign in");
  const res = await request.post(`${BASE_URL}/login`, { form: { email, password }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toBe("/items");
  const cookie = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("session="));
  if (!cookie) throw new Error("sign-in returned no session cookie");
  return cookie.value.split(";")[0].slice("session=".length);
}

test.describe("GET /api/health/version", () => {
  test("answers 200 with JSON holding exactly the package.json version", async ({ request }) => {
    expect(typeof PACKAGE_VERSION).toBe("string");
    const res = await request.get(`${BASE_URL}${VERSION_PATH}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(body).toStrictEqual({ version: PACKAGE_VERSION });
    expect(typeof body.version).toBe("string");
  });

  test("needs no sign-in: anonymous, signed-in and tampered-cookie requests get the same answer", async ({ playwright }) => {
    // A fresh context per request so no cookie carries over between them.
    const ctx = await playwright.request.newContext();
    try {
      const token = await signIn(ctx);
      // Confirm the session is real, so the signed-in request below is one.
      const me = await ctx.get(`${BASE_URL}/api/me`, { headers: { Cookie: `session=${token}` } });
      expect(me.status()).toBe(200);

      const anonCtx = await playwright.request.newContext();
      const anonymous = await anonCtx.get(`${BASE_URL}${VERSION_PATH}`);
      const signedIn = await anonCtx.get(`${BASE_URL}${VERSION_PATH}`, { headers: { Cookie: `session=${token}` } });
      const tampered = await anonCtx.get(`${BASE_URL}${VERSION_PATH}`, { headers: { Cookie: "session=s%3Aforged.invalidsig" } });
      try {
        for (const [label, res] of [["anonymous", anonymous], ["signed-in", signedIn], ["tampered", tampered]] as const) {
          expect(res.status(), `${label} status`).toBe(200);
          expect(await res.json(), `${label} body`).toStrictEqual({ version: PACKAGE_VERSION });
        }
      } finally {
        await anonCtx.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });
});
