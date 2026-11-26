import { test, expect, APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

// GET /api/items/count: the number of stored items, as JSON {"count": <integer>}.
const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

async function getCount(request: APIRequestContext, path = "/api/items/count"): Promise<number> {
  const res = await request.get(`${BASE_URL}${path}`);
  expect(res.status()).toBe(200);
  return (await res.json()).count;
}

async function listItems(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const res = await request.get(`${BASE_URL}/api/items`);
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe("GET /api/items/count", () => {
  test("answers 200 JSON with a count equal to the number of listed items", async ({ request }) => {
    // Create an item of our own so the store is not empty and the count must reflect it.
    const name = `count-probe-${randomUUID()}`;
    const created = await request.post(`${BASE_URL}/api/items`, { data: { name } });
    expect(created.status()).toBe(201);

    // Other tests may create items concurrently: retry until list and count agree back-to-back.
    await expect(async () => {
      const items = await listItems(request);
      expect(items.some((i) => i.name === name)).toBe(true);
      const res = await request.get(`${BASE_URL}/api/items/count`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/json");
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["count"]);
      expect(body.count).toBe(items.length);
    }).toPass({ timeout: 10_000 });
  });

  test("count is a non-negative integer JSON number, not a string", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
    // The raw text carries a bare number, not a quoted one.
    expect(await res.text()).toMatch(/^\{"count":\d+\}$/);
  });

  test("creating an item raises the count by exactly one", async ({ request }) => {
    const name = `count-probe-${randomUUID()}`;
    const before = await listItems(request);
    const c0 = await getCount(request);

    const created = await request.post(`${BASE_URL}/api/items`, { data: { name } });
    expect(created.status()).toBe(201);
    const item = await created.json();
    expect(item.name).toBe(name);

    const c1 = await getCount(request);
    const after = await listItems(request);
    // Items this test did not make may appear in between; count only ours exactly.
    const othersAdded = after.filter((i) => !before.some((b) => b.id === i.id) && i.id !== item.id).length;
    expect(c1 - c0 - othersAdded).toBe(1);
    expect(after.filter((i) => i.name === name)).toHaveLength(1);
    expect(c1).toBe(after.length);
  });

  test("a refused create (missing or blank name) leaves the count unchanged", async ({ request }) => {
    const before = await listItems(request);
    const c0 = await getCount(request);

    const missing = await request.post(`${BASE_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });

    const blank = await request.post(`${BASE_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });

    const c1 = await getCount(request);
    const after = await listItems(request);
    const othersAdded = after.filter((i) => !before.some((b) => b.id === i.id)).length;
    expect(after.some((i) => i.name.trim() === "")).toBe(false);
    expect(c1 - othersAdded).toBe(c0);
  });

  test("is public: same count without a session cookie and with one", async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const signedIn = await playwright.request.newContext();
    try {
      const login = await signedIn.post(`${BASE_URL}/login`, {
        form: { email: process.env.SKYRAMP_UI_USERNAME as string, password: process.env.SKYRAMP_UI_PASSWORD as string },
        maxRedirects: 0,
      });
      expect(login.status()).toBe(303);
      expect(login.headers()["location"]).toBe("/items");
      const me = await signedIn.get(`${BASE_URL}/api/me`);
      expect(me.status()).toBe(200);

      await expect(async () => {
        const a = await anon.get(`${BASE_URL}/api/items/count`);
        const s = await signedIn.get(`${BASE_URL}/api/items/count`);
        expect(a.status()).toBe(200);
        expect(s.status()).toBe(200);
        const ac = (await a.json()).count;
        expect(Number.isInteger(ac)).toBe(true);
        expect((await s.json()).count).toBe(ac);
      }).toPass({ timeout: 10_000 });
    } finally {
      await anon.dispose();
      await signedIn.dispose();
    }
  });

  test("ignores query strings and counts all items", async ({ request }) => {
    await expect(async () => {
      const plain = await getCount(request);
      const filtered = await getCount(request, "/api/items/count?limit=1&name=zzz");
      expect(filtered).toBe(plain);
      expect(filtered).toBe((await listItems(request)).length);
    }).toPass({ timeout: 10_000 });
  });
});
