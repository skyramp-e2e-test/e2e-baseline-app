import { test, expect, APIRequestContext, APIResponse } from "@playwright/test";

// GET /api/items/count answers the number of stored items as JSON {"count": <integer>}.
const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The checks below compare the count with what GET /api/items lists and with
// what this file creates, so its tests run one after another.
test.describe.configure({ mode: "serial" });

async function readCount(request: APIRequestContext, path = "/api/items/count"): Promise<number> {
  const response = await request.get(`${APP_URL}${path}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["count"]);
  return body.count;
}

async function listLength(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${APP_URL}/api/items`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body)).toBe(true);
  return body.length;
}

// Reads the list, the count, then the list again, and gives the count with the
// list length once both list reads agree (no write landed in between).
async function countAndListLength(request: APIRequestContext): Promise<{ count: number; length: number }> {
  let snapshot = { count: -1, length: -2 };
  await expect
    .poll(async () => {
      const before = await listLength(request);
      const count = await readCount(request);
      const after = await listLength(request);
      snapshot = { count, length: before };
      return before === after;
    })
    .toBe(true);
  return snapshot;
}

async function signInCookie(request: APIRequestContext): Promise<string> {
  const response: APIResponse = await request.post(`${APP_URL}/login`, {
    form: { email: process.env.SKYRAMP_UI_USERNAME!, password: process.env.SKYRAMP_UI_PASSWORD! },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"]).toBe("/items");
  const setCookie = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie");
  const cookie = setCookie?.value.match(/^(session=[^;]+)/)?.[1];
  expect(cookie, "sign-in sets a session cookie").toBeTruthy();
  return cookie!;
}

test("GET /api/items/count answers 200 JSON with the number of items GET /api/items lists", async ({ request }) => {
  const response = await request.get(`${APP_URL}/api/items/count`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const { count, length } = await countAndListLength(request);
  expect(count).toBe(length);
});

test("count is a non-negative integer JSON number, not a string", async ({ request }) => {
  const response = await request.get(`${APP_URL}/api/items/count`);
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toMatch(/^\{"count":\d+\}$/);
  const body = JSON.parse(text);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);
});

test("count rises by exactly one per item created with POST /api/items", async ({ request }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const names = [`count-probe-${runId}-0`, `count-probe-${runId}-1`];

  const before = await readCount(request);
  for (const name of names) {
    const created = await request.post(`${APP_URL}/api/items`, { data: { name } });
    expect(created.status()).toBe(201);
    expect((await created.json()).name).toBe(name);
  }

  const after = await readCount(request);
  expect(after).toBe(before + 2);

  // Both created items are listed, and the count still matches the list.
  const listed = await (await request.get(`${APP_URL}/api/items`)).json();
  const listedNames = listed.map((item: { name: string }) => item.name);
  for (const name of names) expect(listedNames).toContain(name);
  const { count, length } = await countAndListLength(request);
  expect(count).toBe(length);
});

test("a refused POST /api/items leaves the count unchanged", async ({ request }) => {
  const before = await readCount(request);

  for (const data of [{}, { name: "" }, { name: "   " }, { name: null }, { name: 123 }]) {
    const refused = await request.post(`${APP_URL}/api/items`, { data });
    expect(refused.status(), JSON.stringify(data)).toBe(400);
    expect(await refused.json(), JSON.stringify(data)).toEqual({ error: "name is required" });
  }

  expect(await readCount(request)).toBe(before);
});

test("count is readable without signing in, the same as with a session", async ({ request }) => {
  const anonymous = await request.get(`${APP_URL}/api/items/count`);
  expect(anonymous.status()).toBe(200);
  const anonymousBody = await anonymous.json();

  const cookie = await signInCookie(request);
  const signedIn = await request.get(`${APP_URL}/api/items/count`, { headers: { Cookie: cookie } });
  expect(signedIn.status()).toBe(200);
  expect(await signedIn.json()).toEqual({ count: anonymousBody.count });
});

test("count route ignores query strings and leaves GET /api/items listing an array", async ({ request }) => {
  const plain = await readCount(request);
  const withQuery = await readCount(request, "/api/items/count?foo=bar&count=99");
  expect(withQuery).toBe(plain);

  const items = await request.get(`${APP_URL}/api/items`);
  expect(items.status()).toBe(200);
  expect(Array.isArray(await items.json())).toBe(true);
});
