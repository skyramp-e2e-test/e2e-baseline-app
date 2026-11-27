// GET /api/items/count: the number of items stored, as JSON {"count": <n>}.
import { test, expect, APIRequestContext } from "@playwright/test";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function listItems(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  return body;
}

async function createItem(request: APIRequestContext, name: string) {
  const res = await request.post(`${APP_URL}/api/items`, { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body;
}

test.describe("GET /api/items/count", () => {
  test("count equals the number of items GET /api/items returns", async ({ request }) => {
    const name = `count-a-${uniq()}`;
    const created = await createItem(request, name);
    const items = await listItems(request);
    expect(items.map((i) => i.id)).toContain(created.id);
    const count = await readCount(request);
    expect(count).toBe(items.length);
  });

  test("count is the number of items stored, not one more", async ({ request }) => {
    let items = await listItems(request);
    if (items.length === 0) {
      await createItem(request, `count-f-${uniq()}`);
      items = await listItems(request);
    }
    const count = await readCount(request);
    expect(count).not.toBe(items.length + 1);
    expect(count).toBe(items.length);
  });

  test("creating one item raises the count by exactly one", async ({ request }) => {
    const c0 = await readCount(request);
    const name = `count-b-${uniq()}`;
    const created = await createItem(request, name);
    const c1 = await readCount(request);
    expect(c1).toBe(c0 + 1);
    const items = await listItems(request);
    expect(items.filter((i) => i.name === name).map((i) => i.id)).toEqual([created.id]);
    expect(c1).toBe(items.length);
  });

  test("a refused create leaves the count unchanged", async ({ request }) => {
    const c0 = await readCount(request);
    const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });
    const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });
    const c1 = await readCount(request);
    expect(c1).toBe(c0);
    const items = await listItems(request);
    expect(c1).toBe(items.length);
  });

  test("count is readable without a session cookie", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext();
    try {
      const res = await anonymous.get(`${APP_URL}/api/items/count`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["count"]);
      expect(Number.isInteger(body.count)).toBe(true);
    } finally {
      await anonymous.dispose();
    }
  });
});
