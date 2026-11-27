// GET /api/items/count: the number of items stored, as {"count": <integer>},
// agreeing with the items GET /api/items lists.
import { test, expect, APIRequestContext } from "@playwright/test";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

async function listLength(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  const items = await res.json();
  expect(Array.isArray(items)).toBe(true);
  return items.length;
}

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

test("count equals the number of items GET /api/items lists", async ({ request }) => {
  const length = await listLength(request);
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body).toEqual({ count: length });
});

test("count is not one more than the number of items stored", async ({ request }) => {
  const length = await listLength(request);
  const count = await readCount(request);
  expect(count).toBe(length);
});

test("creating an item raises the count by exactly one and it matches the list", async ({ request }) => {
  const count0 = await readCount(request);
  const name = `count-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(`${APP_URL}/api/items`, { data: { name } });
  expect(created.status()).toBe(201);
  expect((await created.json()).name).toBe(name);

  const count1 = await readCount(request);
  const listRes = await request.get(`${APP_URL}/api/items`);
  expect(listRes.status()).toBe(200);
  const items: Array<{ name: string }> = await listRes.json();
  expect(items.filter((item) => item.name === name)).toHaveLength(1);

  expect(count1).toBe(count0 + 1);
  expect(count1).toBe(items.length);
});

test("a refused create leaves the count unchanged", async ({ request }) => {
  const count0 = await readCount(request);

  const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toEqual({ error: "name is required" });

  const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "name is required" });

  const count1 = await readCount(request);
  expect(count1).toBe(count0);
  expect(count1).toBe(await listLength(request));
});

test("count is readable without signing in", async ({ playwright }) => {
  const anonymous = await playwright.request.newContext();
  try {
    const res = await anonymous.get(`${APP_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["count"]);
    expect(Number.isInteger(body.count)).toBe(true);
  } finally {
    await anonymous.dispose();
  }
});
