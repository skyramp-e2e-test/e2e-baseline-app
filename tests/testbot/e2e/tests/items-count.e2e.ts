// GET /api/items/count: the number of items stored, as JSON {"count": <integer>}.
import { test, expect, APIRequestContext, APIResponse } from "@playwright/test";
import { randomUUID } from "crypto";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

async function listItems(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  return body;
}

async function readCount(request: APIRequestContext, headers?: Record<string, string>): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`, { headers });
  await expectCountResponse(res);
  return (await res.json()).count;
}

async function expectCountResponse(res: APIResponse) {
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(Number.isInteger(body.count)).toBe(true);
}

// Reads list, count, list; repeats until both list reads agree, so no other writer slipped in between.
async function snapshot(request: APIRequestContext) {
  for (let attempt = 0; ; attempt++) {
    const before = await listItems(request);
    const count = await readCount(request);
    const after = await listItems(request);
    if (before.length === after.length || attempt >= 4) {
      expect(after.length).toBe(before.length);
      return { count, length: after.length, items: after };
    }
  }
}

async function createItem(request: APIRequestContext) {
  const name = `count-probe-${randomUUID()}`;
  const res = await request.post(`${APP_URL}/api/items`, { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body as { id: number; name: string };
}

test("count equals the number of items the list returns", async ({ request }) => {
  const before = await listItems(request);
  const res = await request.get(`${APP_URL}/api/items/count`);
  await expectCountResponse(res);
  const body = await res.json();
  const after = await listItems(request);
  expect(after.length).toBe(before.length);
  expect(body).toEqual({ count: before.length });
});

test("creating an item raises the count by one and the count matches the list", async ({ request }) => {
  const c0 = (await snapshot(request)).count;

  const first = await createItem(request);
  const s1 = await snapshot(request);
  expect(s1.items.map((i) => i.id)).toContain(first.id);
  expect(s1.count).toBe(c0 + 1);
  expect(s1.count).toBe(s1.length);

  const second = await createItem(request);
  const s2 = await snapshot(request);
  expect(s2.items.map((i) => i.id)).toContain(second.id);
  expect(s2.count).toBe(s1.count + 1);
  expect(s2.count).toBe(s2.length);
});

test("a refused create leaves the count unchanged", async ({ request }) => {
  const c0 = (await snapshot(request)).count;

  const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "name is required" });

  const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toEqual({ error: "name is required" });

  const s1 = await snapshot(request);
  expect(s1.count).toBe(c0);
  expect(s1.count).toBe(s1.length);
});

test("reading the count twice gives the same value and changes nothing", async ({ request }) => {
  const l0 = (await listItems(request)).length;
  const first = await readCount(request);
  const second = await readCount(request);
  const l1 = (await listItems(request)).length;
  expect(l1).toBe(l0);
  expect(second).toBe(first);
});

test("count is readable signed out, with the same value as signed in", async ({ request }) => {
  const token = process.env.SKYRAMP_TEST_TOKEN;
  expect(token, "SKYRAMP_TEST_TOKEN (the test user's session cookie) must be set").toBeTruthy();
  const signedOut = await readCount(request);
  const signedIn = await readCount(request, { Cookie: `session=${token}` });
  expect(signedIn).toBe(signedOut);
});
