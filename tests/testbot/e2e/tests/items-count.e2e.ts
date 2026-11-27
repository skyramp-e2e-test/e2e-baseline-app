import { test, expect, APIRequestContext } from "@playwright/test";

// GET /api/items/count must report the number of items stored, as {"count": <integer>}:
// the same number GET /api/items lists at that moment.
const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

function headers(): Record<string, string> {
  const token = process.env.SKYRAMP_TEST_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BASE_URL}/api/items/count`, { headers: headers() });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function listItems(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const res = await request.get(`${BASE_URL}/api/items`, { headers: headers() });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  return body;
}

async function createItem(request: APIRequestContext, name: string): Promise<{ id: number; name: string }> {
  const res = await request.post(`${BASE_URL}/api/items`, { headers: headers(), data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  expect(Number.isInteger(body.id)).toBe(true);
  return body;
}

test.describe("GET /api/items/count", () => {
  test("count equals the number of items GET /api/items lists", async ({ request }) => {
    const first = await createItem(request, uniqueName("count-list"));
    const second = await createItem(request, uniqueName("count-list"));

    const items = await listItems(request);
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    const res = await request.get(`${BASE_URL}/api/items/count`, { headers: headers() });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ count: items.length });
  });

  test("creating an item raises the count by exactly one", async ({ request }) => {
    const before = await readCount(request);

    const name = uniqueName("count");
    const created = await createItem(request, name);

    const after = await readCount(request);
    expect(after).toBe(before + 1);

    const items = await listItems(request);
    expect(items.filter((i) => i.name === name).map((i) => i.id)).toEqual([created.id]);
    expect(after).toBe(items.length);
  });

  test("a refused create leaves the count unchanged", async ({ request }) => {
    const before = await readCount(request);

    for (const data of [{}, { name: "   " }]) {
      const res = await request.post(`${BASE_URL}/api/items`, { headers: headers(), data });
      expect(res.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
      expect(await res.json()).toEqual({ error: "name is required" });
    }

    const after = await readCount(request);
    expect(after).toBe(before);

    const items = await listItems(request);
    expect(after).toBe(items.length);
  });
});
