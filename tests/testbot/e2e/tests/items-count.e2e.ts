// GET /api/items/count: returns {"count": <integer>}, the number of items stored.
import { test, expect, APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://127.0.0.1:3000";

async function readCount(request: APIRequestContext, headers: Record<string, string> = {}): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`, { headers });
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
  test("count equals the number of items the list returns", async ({ request }) => {
    const name = `count-test-${randomUUID()}`;
    await createItem(request, name);
    const items = await listItems(request);
    expect(items.map((i) => i.name)).toContain(name);
    const count = await readCount(request);
    expect(count).toBe(items.length);
  });

  test("creating one item raises the count by exactly one", async ({ request }) => {
    const before = await readCount(request);
    const name = `count-test-${randomUUID()}`;
    await createItem(request, name);
    const after = await readCount(request);
    expect(after).toBe(before + 1);
    const items = await listItems(request);
    expect(items.filter((i) => i.name === name)).toHaveLength(1);
    expect(after).toBe(items.length);
  });

  test("a rejected create leaves the count as it was", async ({ request }) => {
    const before = await readCount(request);
    const listBefore = await listItems(request);

    const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });

    const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });

    const after = await readCount(request);
    expect(after).toBe(before);
    expect((await listItems(request)).length).toBe(listBefore.length);
  });

  test("count is readable without signing in and the same when signed in", async ({ playwright, request }) => {
    const anonymous = await readCount(request);
    expect(anonymous).toBeGreaterThanOrEqual(0);

    const signIn = await playwright.request.newContext();
    try {
      const login = await signIn.post(`${APP_URL}/login`, {
        form: { email: process.env.SKYRAMP_UI_USERNAME ?? "", password: process.env.SKYRAMP_UI_PASSWORD ?? "" },
        maxRedirects: 0,
      });
      expect(login.status()).toBe(303);
      expect(login.headers()["location"]).toBe("/items");
      const me = await signIn.get(`${APP_URL}/api/me`);
      expect(me.status()).toBe(200);

      const signedIn = await readCount(signIn);
      expect(signedIn).toBe(anonymous);
    } finally {
      await signIn.dispose();
    }
  });

  test("reading the count twice changes nothing", async ({ request }) => {
    const listBefore = await listItems(request);
    const first = await readCount(request);
    const second = await readCount(request);
    expect(second).toBe(first);
    expect((await listItems(request)).length).toBe(listBefore.length);
  });
});
