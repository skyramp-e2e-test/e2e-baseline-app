import { test, expect, APIRequestContext } from "@playwright/test";

// GET /api/items/count returns the number of stored items as JSON {"count": <integer>}.
const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// Each test compares the shared count before and after its own writes, so they run one at a time.
test.describe.configure({ mode: "serial" });

function uniqueName(): string {
  return `count-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BASE_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.count;
}

async function listItems(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const res = await request.get(`${BASE_URL}/api/items`);
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe("GET /api/items/count", () => {
  test("anonymous request answers 200 JSON with count equal to the items listed", async ({ playwright }) => {
    // A fresh context carries no cookies: no sign-in.
    const request = await playwright.request.newContext();
    try {
      const items = await listItems(request);
      const res = await request.get(`${BASE_URL}/api/items/count`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/json");
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["count"]);
      expect(body.count).toBe(items.length);
    } finally {
      await request.dispose();
    }
  });

  test("count is a JSON integer, not a string", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    const raw = await res.text();
    expect(raw).toMatch(/^\{"count":\d+\}$/);
    const body = JSON.parse(raw);
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  test("count goes up by exactly one after each created item", async ({ request }) => {
    const c0 = await getCount(request);

    const first = uniqueName();
    const created1 = await request.post(`${BASE_URL}/api/items`, { data: { name: first } });
    expect(created1.status()).toBe(201);
    expect((await created1.json()).name).toBe(first);

    const c1 = await getCount(request);
    expect(c1).toBe(c0 + 1);
    const afterFirst = await listItems(request);
    expect(afterFirst.filter((i) => i.name === first)).toHaveLength(1);
    expect(c1).toBe(afterFirst.length);

    const second = uniqueName();
    const created2 = await request.post(`${BASE_URL}/api/items`, { data: { name: second } });
    expect(created2.status()).toBe(201);
    expect((await created2.json()).name).toBe(second);

    const c2 = await getCount(request);
    expect(c2).toBe(c0 + 2);
    const afterSecond = await listItems(request);
    expect(afterSecond.filter((i) => i.name === second)).toHaveLength(1);
    expect(c2).toBe(afterSecond.length);
  });

  test("refused creates (missing or blank name) leave the count unchanged", async ({ request }) => {
    const c0 = await getCount(request);

    const missing = await request.post(`${BASE_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });

    const blank = await request.post(`${BASE_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });

    const c1 = await getCount(request);
    expect(c1).toBe(c0);
    expect(c1).toBe((await listItems(request)).length);
  });
});
