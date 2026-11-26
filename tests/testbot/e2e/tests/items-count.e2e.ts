// Functional tests for GET /api/items/count: it answers with the number of stored items as {"count": <integer>}.
import { test, expect, APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The tests read and change the shared item total, so they run one after another.
test.describe.configure({ mode: "serial" });

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.count).toBe("number");
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
  return body as { id: number; name: string };
}

test("count answers 200 with a JSON object whose only key is count, a non-negative integer", async ({ playwright }) => {
  // A fresh context: no session cookie is sent.
  const request = await playwright.request.newContext();
  try {
    const res = await request.get(`${APP_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^application\/json/);
    const body = await res.json();
    expect(typeof body).toBe("object");
    expect(Array.isArray(body)).toBe(false);
    expect(Object.keys(body)).toEqual(["count"]);
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
  } finally {
    await request.dispose();
  }
});

test("count equals the number of items GET /api/items lists", async ({ request }) => {
  // At least one item, so a count stuck at 0 cannot match an empty list.
  await createItem(request, `count-test-${randomUUID()}`);
  const items = await listItems(request);
  const count = await readCount(request);
  expect(items.length).toBeGreaterThan(0);
  expect(count).toBe(items.length);
});

test("count goes up by exactly one after an item is created", async ({ request }) => {
  const before = await readCount(request);
  const name = `count-test-${randomUUID()}`;
  const created = await createItem(request, name);
  const after = await readCount(request);
  const items = await listItems(request);
  expect(after).toBe(before + 1);
  expect(after).toBe(items.length);
  expect(items.filter((i) => i.name === name).map((i) => i.id)).toEqual([created.id]);
});

test("a refused create with a missing or blank name leaves the count as it was", async ({ request }) => {
  const before = await readCount(request);

  const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "name is required" });

  const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toEqual({ error: "name is required" });

  const after = await readCount(request);
  expect(after).toBe(before);
  expect(after).toBe((await listItems(request)).length);
});

test("repeated count reads give the same count and change no items", async ({ request }) => {
  const listBefore = await listItems(request);
  const first = await readCount(request);
  const second = await readCount(request);
  const listAfter = await listItems(request);
  expect(second).toBe(first);
  expect(first).toBe(listBefore.length);
  expect(listAfter.length).toBe(listBefore.length);
});
