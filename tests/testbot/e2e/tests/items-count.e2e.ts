import { test, expect, APIRequestContext } from "@playwright/test";

// GET /api/items/count: the number of stored items, as {"count": <integer>}, readable without signing in.
const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";
// The app has no route that deletes an item, so names carry this run's id to find what it left behind.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// The user the app seeds at startup (src/db.js); its sign-in comes from the run's login variables.
const SEEDED_EMAIL = process.env.SKYRAMP_UI_USERNAME as string;
const SEEDED_PASSWORD = process.env.SKYRAMP_UI_PASSWORD as string;

async function readCount(request: APIRequestContext) {
  const response = await request.get(`${BASE_URL}/api/items/count`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count as number;
}

async function listLength(request: APIRequestContext) {
  const response = await request.get(`${BASE_URL}/api/items`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body)).toBe(true);
  return body.length as number;
}

async function createItem(request: APIRequestContext, name: string) {
  const response = await request.post(`${BASE_URL}/api/items`, { data: { name } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.name).toBe(name);
  return body;
}

test.describe("GET /api/items/count", () => {
  test("count equals the number of items GET /api/items lists", async ({ request }) => {
    // Seed one item of our own so the table is never compared only while empty.
    await createItem(request, `count-test-${RUN_ID}-list`);
    const length = await listLength(request);
    const count = await readCount(request);
    expect(count).toBe(length);
  });

  test("creating an item raises the count by exactly one", async ({ request }) => {
    const c0 = await readCount(request);
    await createItem(request, `count-test-${RUN_ID}-a`);
    const c1 = await readCount(request);
    expect(c1).toBe(c0 + 1);
    expect(c1).toBe(await listLength(request));

    await createItem(request, `count-test-${RUN_ID}-b`);
    const c2 = await readCount(request);
    expect(c2).toBe(c0 + 2);
    expect(c2).toBe(await listLength(request));
  });

  test("a refused create leaves the count unchanged", async ({ request }) => {
    const c0 = await readCount(request);

    const blank = await request.post(`${BASE_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });

    const missing = await request.post(`${BASE_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });

    expect(await readCount(request)).toBe(c0);
  });

  test("count is readable without signing in, and the same when signed in", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext();
    const signedIn = await playwright.request.newContext();
    try {
      const login = await signedIn.post(`${BASE_URL}/login`, {
        form: { email: SEEDED_EMAIL, password: SEEDED_PASSWORD },
        maxRedirects: 0,
      });
      expect(login.status()).toBe(303);
      expect(login.headers()["location"]).toBe("/items");
      const me = await signedIn.get(`${BASE_URL}/api/me`);
      expect(me.status()).toBe(200);
      expect(await me.json()).toEqual({ email: SEEDED_EMAIL.trim().toLowerCase() });

      const withoutCookie = await readCount(anonymous);
      const withCookie = await readCount(signedIn);
      expect(withCookie).toBe(withoutCookie);
    } finally {
      await anonymous.dispose();
      await signedIn.dispose();
    }
  });
});
