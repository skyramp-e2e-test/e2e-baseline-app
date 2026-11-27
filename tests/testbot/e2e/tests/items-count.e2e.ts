// GET /api/items/count: the number of items stored, as {"count": <integer>}.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

type Item = { id: number; name: string; created_at: string };

async function listItems(request: APIRequestContext): Promise<Item[]> {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  return res.json();
}

async function getCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function createItem(request: APIRequestContext, name: string): Promise<Item> {
  const res = await request.post(`${APP_URL}/api/items`, { data: { name } });
  expect(res.status()).toBe(201);
  const item = await res.json();
  expect(item.name).toBe(name);
  return item;
}

// The count and the list, read while no other writer changed the list in between.
async function countWithList(request: APIRequestContext): Promise<{ count: number; items: Item[] }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await listItems(request);
    const count = await getCount(request);
    const after = await listItems(request);
    if (before.length === after.length) return { count, items: after };
  }
  throw new Error("the items list kept changing while the count was read");
}

test("count equals the number of items the list returns", async ({ request }) => {
  const names = [`count-a-${randomUUID()}`, `count-a-${randomUUID()}`];
  for (const name of names) await createItem(request, name);

  const { count, items } = await countWithList(request);
  for (const name of names) expect(items.map((i) => i.name)).toContain(name);
  expect(count).toBe(items.length);
});

test("creating one item raises the count by exactly one", async ({ request }) => {
  const c0 = await getCount(request);
  const name = `count-b-${randomUUID()}`;
  await createItem(request, name);
  const { count: c1, items } = await countWithList(request);

  expect(c1).toBe(c0 + 1);
  expect(items.map((i) => i.name)).toContain(name);
  expect(c1).toBe(items.length);
});

test("a refused create leaves the count unchanged", async ({ request }) => {
  const c0 = await getCount(request);

  for (const data of [{}, { name: "   " }, { name: 123 }, { name: null }]) {
    const res = await request.post(`${APP_URL}/api/items`, { data });
    expect(res.status(), JSON.stringify(data)).toBe(400);
    expect(await res.json()).toEqual({ error: "name is required" });
  }

  const { count: c1, items } = await countWithList(request);
  expect(c1).toBe(c0);
  expect(c1).toBe(items.length);
});

test("count is not one more than the items stored", async ({ request }) => {
  const name = `count-f1-${randomUUID()}`;
  await createItem(request, name);

  const { count, items } = await countWithList(request);
  expect(items.map((i) => i.name)).toContain(name);
  expect(count).not.toBe(items.length + 1);
  expect(count).toBe(items.length);
});
