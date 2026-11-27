// GET /api/items/count: the number of stored items, as {"count": <integer>}, public like GET /api/items.
import { test, expect, APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// Count and list reads below compare values read back-to-back, so this file's tests never run alongside each other.
test.describe.configure({ mode: "serial" });

async function readCount(request: APIRequestContext, path = "/api/items/count", headers?: Record<string, string>) {
  const response = await request.get(`${BASE_URL}${path}`, { headers });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.count;
}

async function createItem(request: APIRequestContext, name: string) {
  const response = await request.post(`${BASE_URL}/api/items`, { data: { name } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.name).toBe(name);
  return body;
}

async function listItems(request: APIRequestContext) {
  const response = await request.get(`${BASE_URL}/api/items`);
  expect(response.status()).toBe(200);
  return response.json();
}

// Signs in as the account the app seeds at startup and returns its session cookie value.
async function sessionCookie(request: APIRequestContext) {
  const response = await request.post(`${BASE_URL}/login`, {
    form: { email: process.env.SKYRAMP_UI_USERNAME as string, password: process.env.SKYRAMP_UI_PASSWORD as string },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  const setCookie = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("session="));
  expect(setCookie, "sign-in sets the session cookie").toBeTruthy();
  return setCookie!.value.split(";")[0].slice("session=".length);
}

test.describe("GET /api/items/count", () => {
  test("answers 200 with a JSON object holding only a count", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/items/count`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const body = await response.json();
    expect(typeof body).toBe("object");
    expect(Array.isArray(body)).toBe(false);
    expect(Object.keys(body)).toEqual(["count"]);
  });

  test("count is a non-negative integer JSON number, not a string", async ({ request }) => {
    const count = await readCount(request);
    expect(typeof count).toBe("number");
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("count equals the number of items the list returns", async ({ request }) => {
    await createItem(request, `count-seed-${randomUUID()}`);
    const items = await listItems(request);
    const count = await readCount(request);
    expect(count).toBe(items.length);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("creating an item raises the count by exactly one each time", async ({ request }) => {
    const before = await readCount(request);
    const first = await createItem(request, `count-new-${randomUUID()}`);
    const afterFirst = await readCount(request);
    expect(afterFirst).toBe(before + 1);
    const items = await listItems(request);
    expect(items.map((i: { id: number; name: string }) => i.name)).toContain(first.name);

    const second = await createItem(request, `count-new-${randomUUID()}`);
    const afterSecond = await readCount(request);
    expect(afterSecond).toBe(afterFirst + 1);
    const itemsAfter = await listItems(request);
    expect(itemsAfter.map((i: { id: number; name: string }) => i.name)).toContain(second.name);
  });

  test("a refused create leaves the count unchanged", async ({ request }) => {
    const before = await readCount(request);
    for (const data of [{}, { name: "   " }, { name: 123 }]) {
      const response = await request.post(`${BASE_URL}/api/items`, { data });
      expect(response.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
      expect(await response.json()).toEqual({ error: "name is required" });
    }
    const after = await readCount(request);
    expect(after).toBe(before);
  });

  test("count is readable without signing in and a signed-in user gets the same value", async ({ request }) => {
    // Read without a cookie first: signing in stores the session in this request context.
    const anonymous = await readCount(request);
    const session = await sessionCookie(request);
    const signedIn = await readCount(request, "/api/items/count", { Cookie: `session=${session}` });
    expect(typeof anonymous).toBe("number");
    expect(signedIn).toBe(anonymous);
  });

  test("query parameters do not change the count", async ({ request }) => {
    const plain = await readCount(request);
    const withQuery = await readCount(request, "/api/items/count?limit=1&name=x");
    expect(typeof plain).toBe("number");
    expect(withQuery).toBe(plain);
  });
});
