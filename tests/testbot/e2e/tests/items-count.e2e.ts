// Contract tests of GET /api/items/count: it reports the number of items stored, as {"count": <integer>}.
import { test, expect, APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

type Item = { id: number; name: string; created_at: string };

async function getCount(request: APIRequestContext): Promise<unknown> {
  const response = await request.get(`${BASE_URL}/api/items/count`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function listItems(request: APIRequestContext): Promise<Item[]> {
  const response = await request.get(`${BASE_URL}/api/items`);
  expect(response.status()).toBe(200);
  const items = await response.json();
  expect(Array.isArray(items)).toBe(true);
  return items;
}

async function createItem(request: APIRequestContext, name: string): Promise<Item> {
  const response = await request.post(`${BASE_URL}/api/items`, { data: { name } });
  expect(response.status()).toBe(201);
  const item = await response.json();
  expect(item.name).toBe(name);
  return item;
}

/**
 * The count and the list length read at the same moment: the list is read before and after the count, and the
 * reads are taken again if another writer changed the list between them.
 */
async function countWithListLength(request: APIRequestContext): Promise<{ count: unknown; items: Item[] }> {
  for (let attempt = 0; ; attempt++) {
    const before = await listItems(request);
    const count = await getCount(request);
    const after = await listItems(request);
    if (before.length === after.length || attempt === 4) return { count, items: after };
  }
}

test.describe("GET /api/items/count", () => {
  test("count equals the number of items GET /api/items lists", async ({ request }) => {
    const run = randomUUID();
    const first = await createItem(request, `count-probe-${run}-1`);
    const second = await createItem(request, `count-probe-${run}-2`);

    const { count, items } = await countWithListLength(request);
    const names = items.map((item) => item.name);
    expect(names).toContain(first.name);
    expect(names).toContain(second.name);
    expect(count).toBe(items.length);
  });

  test("creating one item raises the count by exactly one", async ({ request }) => {
    const c0 = (await getCount(request)) as number;
    const name = `count-delta-${randomUUID()}`;
    await createItem(request, name);
    const c1 = await getCount(request);
    expect(c1).toBe(c0 + 1);

    const { count, items } = await countWithListLength(request);
    expect(items.map((item) => item.name)).toContain(name);
    expect(count).toBe(items.length);
  });

  test("a refused item creation leaves the count unchanged", async ({ request }) => {
    const c0 = await getCount(request);
    const refused = await request.post(`${BASE_URL}/api/items`, { data: { name: "   " } });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toEqual({ error: "name is required" });
    const c1 = await getCount(request);
    expect(c1).toBe(c0);

    const { count, items } = await countWithListLength(request);
    expect(items.some((item) => item.name.trim() === "")).toBe(false);
    expect(count).toBe(items.length);
  });
});
