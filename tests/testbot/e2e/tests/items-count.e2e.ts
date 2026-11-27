// GET /api/items/count: the number of stored items, as {"count": <integer>}.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
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
  test("count equals the number of items GET /api/items lists", async ({ request }) => {
    const name = `count-test-${randomUUID()}`;
    await createItem(request, name);

    const items = await listItems(request);
    expect(items.map((i) => i.name)).toContain(name);
    const count = await readCount(request);

    expect(count).toBe(items.length);
  });

  test("count is not one more than the number of stored items", async ({ request }) => {
    await createItem(request, `count-test-${randomUUID()}`);

    const items = await listItems(request);
    const res = await request.get(`${APP_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toEqual({ count: items.length });
    expect(body.count).not.toBe(items.length + 1);
  });

  test("creating one item raises the count by exactly one", async ({ request }) => {
    const c0 = await readCount(request);
    const l0 = (await listItems(request)).length;

    const name = `count-inc-${randomUUID()}`;
    await createItem(request, name);

    const c1 = await readCount(request);
    const items1 = await listItems(request);
    expect(items1.filter((i) => i.name === name)).toHaveLength(1);

    expect(c1).toBe(c0 + 1);
    expect(c0).toBe(l0);
    expect(c1).toBe(items1.length);
  });

  test("a create refused for a missing or blank name leaves the count unchanged", async ({ request }) => {
    const c0 = await readCount(request);

    const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });

    const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });

    const c1 = await readCount(request);
    const items = await listItems(request);

    expect(c1).toBe(c0);
    expect(c1).toBe(items.length);
  });

  test("reading the count twice without a write returns the same count", async ({ request }) => {
    const first = await readCount(request);
    const second = await readCount(request);
    const items = await listItems(request);

    expect(second).toBe(first);
    expect(items.length).toBe(second);
  });
});
