// GET /api/items/count: the number of stored items, as {"count": <integer>}.
import { test, expect, APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The count is shared state: run these one after another so this file's own creates do not race its reads.
test.describe.configure({ mode: "serial" });

function uniqueName(label: string): string {
  return `count-probe-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function listItems(request: APIRequestContext): Promise<Array<{ id: number; name: string; created_at: string }>> {
  const res = await request.get(`${BASE_URL}/api/items`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  return body;
}

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BASE_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);
  return body.count;
}

test.describe("GET /api/items/count", () => {
  test("answers an unauthenticated request with an integer count equal to the items list length", async ({ request }) => {
    const before = await listItems(request);

    // Sent without a cookie or Authorization header.
    const res = await request.get(`${BASE_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["count"]);
    // A JSON number, not the string pg returns for a bigint COUNT(*).
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
    expect(body.count).toBe(before.length);

    const after = await listItems(request);
    expect(after.length).toBe(body.count);
  });

  test("rises by exactly one for each item created, matching the new list length", async ({ request }) => {
    const c0 = await readCount(request);

    const firstName = uniqueName("a");
    const first = await request.post(`${BASE_URL}/api/items`, { data: { name: firstName } });
    expect(first.status()).toBe(201);
    expect((await first.json()).name).toBe(firstName);

    const c1 = await readCount(request);
    expect(c1).toBe(c0 + 1);

    const secondName = uniqueName("b");
    const second = await request.post(`${BASE_URL}/api/items`, { data: { name: secondName } });
    expect(second.status()).toBe(201);
    expect((await second.json()).name).toBe(secondName);

    const c2 = await readCount(request);
    expect(c2).toBe(c0 + 2);

    const items = await listItems(request);
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining([firstName, secondName]));
    expect(items.length).toBe(c2);
  });

  test("is unchanged by a create the app refuses", async ({ request }) => {
    const c0 = await readCount(request);

    for (const data of [{}, { name: "" }, { name: "   " }, { name: 123 }]) {
      const res = await request.post(`${BASE_URL}/api/items`, { data });
      expect(res.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
      expect(await res.json()).toEqual({ error: "name is required" });
    }

    const c1 = await readCount(request);
    expect(c1).toBe(c0);
  });

  test("reading the count changes no data", async ({ request }) => {
    const list0 = await listItems(request);
    const a = await readCount(request);
    const b = await readCount(request);
    const list1 = await listItems(request);

    expect(a).toBe(b);
    expect(list1).toEqual(list0);
    expect(a).toBe(list0.length);
  });
});
