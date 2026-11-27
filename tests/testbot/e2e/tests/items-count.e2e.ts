// GET /api/items/count: returns the number of rows in the items table as {"count": <integer>}.
import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The count is global to the app; the package config does not set fullyParallel, so the tests
// of this file run one after another in a single worker and do not interleave.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Item = { id: number; name: string; created_at: string };

async function listItems(request: APIRequestContext): Promise<Item[]> {
  const response = await request.get(`${BASE_URL}/api/items`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body)).toBe(true);
  return body as Item[];
}

async function getCount(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${BASE_URL}/api/items/count`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function createItem(request: APIRequestContext, name: string): Promise<Item> {
  const response = await request.post(`${BASE_URL}/api/items`, { data: { name } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.name).toBe(name);
  expect(Number.isInteger(body.id)).toBe(true);
  return body as Item;
}

test("count is 0 when no items are stored, otherwise the number of stored items", async ({ request }) => {
  const items = await listItems(request);
  const count = await getCount(request);
  if (items.length === 0) {
    expect(count).toBe(0);
  } else {
    expect(count).toBe(items.length);
  }
});

test("count equals the number of items GET /api/items lists after creating two", async ({ request }) => {
  const a = await createItem(request, `count-a-${runId}`);
  const b = await createItem(request, `count-b-${runId}`);

  const items = await listItems(request);
  expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  const count = await getCount(request);

  expect(count).toBe(items.length);
});

test("each successful item creation raises the count by exactly one", async ({ request }) => {
  const before = await getCount(request);
  const created = await createItem(request, `count-step-${runId}`);
  const after = await getCount(request);

  expect(after).toBe(before + 1);
  const items = await listItems(request);
  expect(items.filter((i) => i.name === created.name)).toHaveLength(1);
  expect(after).toBe(items.length);
});

test("a refused item creation (missing or blank name) does not change the count", async ({ request }) => {
  const before = await getCount(request);

  const missing = await request.post(`${BASE_URL}/api/items`, { data: {} });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "name is required" });

  const blank = await request.post(`${BASE_URL}/api/items`, { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toEqual({ error: "name is required" });

  const after = await getCount(request);
  expect(after).toBe(before);
  const items = await listItems(request);
  expect(after).toBe(items.length);
});

test("count is not one more than the number of stored items", async ({ request }) => {
  const probe = await createItem(request, `f1-probe-${runId}`);

  const items = await listItems(request);
  expect(items.some((i) => i.id === probe.id)).toBe(true);
  const count = await getCount(request);

  expect(count).not.toBe(items.length + 1);
  expect(count).toBe(items.length);
});
