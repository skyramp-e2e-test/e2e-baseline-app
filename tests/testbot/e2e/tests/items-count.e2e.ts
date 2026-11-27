// Contract tests for GET /api/items/count: the number of stored items as {"count": <integer>},
// readable without signing in, like GET /api/items.
import { test, expect, APIRequestContext } from "@playwright/test";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://127.0.0.1:3000";
// Items this file creates carry this prefix; the app has no route that deletes an item.
const RUN_PREFIX = `items-count-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// The count is global to the app, so the cases that compare exact totals run one after another.
test.describe.configure({ mode: "serial" });

async function readCount(request: APIRequestContext, headers?: Record<string, string>): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items/count`, { headers });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  return body.count;
}

async function listLength(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  const items = await res.json();
  expect(Array.isArray(items)).toBe(true);
  return items.length;
}

async function createItem(request: APIRequestContext, name: string) {
  const res = await request.post(`${APP_URL}/api/items`, { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body;
}

test("count equals the number of items the list returns, before and after creates and with a query string", async ({ request }) => {
  const before = await readCount(request);
  expect(before).toBe(await listLength(request));
  expect(await readCount(request)).toBe(before);

  await createItem(request, `${RUN_PREFIX}-list-1`);
  await createItem(request, `${RUN_PREFIX}-list-2`);

  const after = await readCount(request);
  expect(after).toBe(await listLength(request));
  expect(after).toBe(before + 2);
  expect(await readCount(request)).toBe(after);

  const limited = await request.get(`${APP_URL}/api/items/count?limit=1`);
  expect(limited.status()).toBe(200);
  expect(await limited.json()).toEqual({ count: after });
});

test("each accepted create raises the count by exactly one, duplicate names included", async ({ request }) => {
  const c0 = await readCount(request);

  await createItem(request, `${RUN_PREFIX}-count-a`);
  expect(await readCount(request)).toBe(c0 + 1);

  const dup = `${RUN_PREFIX}-dup`;
  await createItem(request, dup);
  await createItem(request, dup);
  expect(await readCount(request)).toBe(c0 + 3);
});

test("a create that POST /api/items refuses leaves the count unchanged", async ({ request }) => {
  const bodies: unknown[] = [{}, { name: "" }, { name: "   " }, { name: 5 }, { name: null }];
  for (const data of bodies) {
    const before = await readCount(request);
    const res = await request.post(`${APP_URL}/api/items`, { data });
    expect(res.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
    expect(await res.json()).toEqual({ error: "name is required" });
    expect(await readCount(request), `count after ${JSON.stringify(data)}`).toBe(before);
  }
});

test("count is a JSON integer, not a string", async ({ request }) => {
  await createItem(request, `${RUN_PREFIX}-int`);
  const res = await request.get(`${APP_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(1);
});

test("count needs no sign-in and is the same signed out, with a forged cookie and signed in", async ({ request, playwright }) => {
  const email = process.env.SKYRAMP_UI_USERNAME;
  const password = process.env.SKYRAMP_UI_PASSWORD;
  expect(email, "SKYRAMP_UI_USERNAME is set").toBeTruthy();
  expect(password, "SKYRAMP_UI_PASSWORD is set").toBeTruthy();

  const anonymous = await request.get(`${APP_URL}/api/items/count`);
  expect(anonymous.status()).toBe(200);
  const anonymousBody = await anonymous.json();
  expect(Object.keys(anonymousBody)).toEqual(["count"]);

  const forged = await request.get(`${APP_URL}/api/items/count`, {
    headers: { Cookie: "session=s%3Aforged.bad" },
  });
  expect(forged.status()).toBe(200);
  expect(await forged.json()).toEqual(anonymousBody);

  const signedIn = await playwright.request.newContext();
  try {
    const login = await signedIn.post(`${APP_URL}/login`, {
      form: { email: email as string, password: password as string },
      maxRedirects: 0,
    });
    expect(login.status()).toBe(303);
    expect(login.headers()["location"]).toBe("/items");
    const me = await signedIn.get(`${APP_URL}/api/me`);
    expect(me.status()).toBe(200);

    const withSession = await signedIn.get(`${APP_URL}/api/items/count`);
    expect(withSession.status()).toBe(200);
    expect(await withSession.json()).toEqual(anonymousBody);
  } finally {
    await signedIn.dispose();
  }
});

test("POST, PUT and DELETE on the count route answer 404 and change nothing", async ({ request }) => {
  const before = await readCount(request);
  for (const method of ["post", "put", "delete"] as const) {
    const res = await request[method](`${APP_URL}/api/items/count`, { data: { count: 0 } });
    expect(res.status(), `${method.toUpperCase()} /api/items/count`).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  }
  expect(await readCount(request)).toBe(before);
});
