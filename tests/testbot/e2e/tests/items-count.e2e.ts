// Functional tests for GET /api/items/count: it returns the number of items stored as JSON {"count": <integer>}.
// The app has no route that deletes items, so the items these tests create (named count-test-<uuid>) stay in the
// database; .skyramp/cleanup/delete-count-test-items.sh removes them.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// Each test reads the count relative to a baseline it takes itself; run them one after another.
test.describe.configure({ mode: "serial" });

async function getCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.count).toBe("number");
  return body.count;
}

async function getListLength(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  return body.length;
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
    // Make sure there is at least one item stored.
    await createItem(request, `count-test-${randomUUID()}`);

    const listRes = await request.get(`${APP_URL}/api/items`);
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    const L = list.length;

    const res = await request.get(`${APP_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^application\/json/);
    const body = await res.json();
    expect(L).toBeGreaterThanOrEqual(1);
    expect(body).toEqual({ count: L });
  });

  test("count is a JSON integer and the only key in the body", async ({ request }) => {
    const res = await request.get(`${APP_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
    expect(Object.keys(body)).toEqual(["count"]);
  });

  test("creating an item raises the count by exactly one", async ({ request }) => {
    const c0 = await getCount(request);
    const l0 = await getListLength(request);
    expect(l0).toBe(c0);

    await createItem(request, `count-test-${randomUUID()}`);
    expect(await getCount(request)).toBe(c0 + 1);
    expect(await getListLength(request)).toBe(c0 + 1);

    await createItem(request, `count-test-${randomUUID()}`);
    expect(await getCount(request)).toBe(c0 + 2);
    expect(await getListLength(request)).toBe(c0 + 2);
  });

  test("a rejected create leaves the count unchanged", async ({ request }) => {
    const c0 = await getCount(request);

    for (const data of [{}, { name: "   " }, { name: 123 }]) {
      const res = await request.post(`${APP_URL}/api/items`, { data });
      expect(res.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
      expect(await res.json()).toEqual({ error: "name is required" });
    }

    expect(await getCount(request)).toBe(c0);
    expect(await getListLength(request)).toBe(c0);
  });

  test("count is readable without signing in and the same when signed in", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext();
    const signedIn = await playwright.request.newContext();
    try {
      const listRes = await anonymous.get(`${APP_URL}/api/items`);
      expect(listRes.status()).toBe(200);
      const anonCount = await anonymous.get(`${APP_URL}/api/items/count`);
      expect(anonCount.status()).toBe(200);
      const anonBody = await anonCount.json();
      expect(Number.isInteger(anonBody.count)).toBe(true);
      expect(anonBody.count).toBe((await listRes.json()).length);

      const login = await signedIn.post(`${APP_URL}/login`, {
        form: { email: process.env.SKYRAMP_UI_USERNAME as string, password: process.env.SKYRAMP_UI_PASSWORD as string },
        maxRedirects: 0,
      });
      expect(login.status()).toBe(303);
      expect(login.headers()["location"]).toBe("/items");
      expect((await signedIn.get(`${APP_URL}/api/me`)).status()).toBe(200);

      const signedCount = await signedIn.get(`${APP_URL}/api/items/count`);
      expect(signedCount.status()).toBe(200);
      expect(await signedCount.json()).toEqual({ count: anonBody.count });
    } finally {
      await anonymous.dispose();
      await signedIn.dispose();
    }
  });

  test("repeated reads return the same count", async ({ request }) => {
    const first = await getCount(request);
    const second = await getCount(request);
    expect(second).toBe(first);
    expect(await getListLength(request)).toBe(first);
  });
});
