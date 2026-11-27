// Contract tests for GET /api/items/count: {"count": N}, N the number of stored items,
// public like GET /api/items and in step with item creation.
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

const APP_URL = (process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000").replace(/\/$/, "");
const COUNT_URL = `${APP_URL}/api/items/count`;
const ITEMS_URL = `${APP_URL}/api/items`;

// The tests in this file read the shared item count before and after their own writes,
// so they run one after another.
test.describe.configure({ mode: "serial" });

const uniqueName = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(COUNT_URL);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function createItem(request: APIRequestContext, name: string) {
  const res = await request.post(ITEMS_URL, { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body;
}

test("count is zero when no items are stored", async ({ request }) => {
  const list = await request.get(ITEMS_URL);
  expect(list.status()).toBe(200);
  const items = await list.json();
  // Without a delete route the test cannot empty the table itself: it checks this only on a fresh database.
  test.skip(items.length > 0, `items table already holds ${items.length} items; this check needs a fresh database`);

  const res = await request.get(COUNT_URL);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(await res.text()).toBe('{"count":0}');
});

test("count is a non-negative JSON integer under the key count", async ({ request }) => {
  const res = await request.get(COUNT_URL);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);
});

test("creating an item raises the count by exactly one each time", async ({ request }) => {
  const c0 = await readCount(request);

  await createItem(request, uniqueName("count-probe"));
  expect(await readCount(request)).toBe(c0 + 1);

  await createItem(request, uniqueName("count-probe"));
  expect(await readCount(request)).toBe(c0 + 2);
});

test("count equals the number of items the item list returns", async ({ request }) => {
  const name = uniqueName("count-match");
  const created = await createItem(request, name);

  const list = await request.get(ITEMS_URL);
  expect(list.status()).toBe(200);
  const items: Array<{ id: number; name: string }> = await list.json();
  expect(items.filter((i) => i.id === created.id && i.name === name)).toHaveLength(1);

  const res = await request.get(COUNT_URL);
  expect(res.status()).toBe(200);
  expect((await res.json()).count).toBe(items.length);
});

test("a rejected item creation leaves the count as it was", async ({ request }) => {
  const c0 = await readCount(request);
  const invalidBodies: unknown[] = [{}, { name: "" }, { name: "   " }, { name: 5 }];

  for (const body of invalidBodies) {
    const res = await request.post(ITEMS_URL, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(body),
    });
    expect(res.status(), `POST ${JSON.stringify(body)}`).toBe(400);
    expect(await res.json(), `POST ${JSON.stringify(body)}`).toEqual({ error: "name is required" });
    expect(await readCount(request), `count after POST ${JSON.stringify(body)}`).toBe(c0);
  }
});

test("count is public: answered without a session and with an invalid session cookie", async () => {
  const anonymous = await playwrightRequest.newContext();
  const bogus = await playwrightRequest.newContext({ extraHTTPHeaders: { Cookie: "session=bogus" } });
  try {
    const items = await (await anonymous.get(ITEMS_URL)).json();

    const noCookie = await anonymous.get(COUNT_URL);
    expect(noCookie.status()).toBe(200);
    const noCookieBody = await noCookie.json();
    expect(Number.isInteger(noCookieBody.count)).toBe(true);
    expect(noCookieBody.count).toBe(items.length);

    const badCookie = await bogus.get(COUNT_URL);
    expect(badCookie.status()).toBe(200);
    const badCookieBody = await badCookie.json();
    expect(Number.isInteger(badCookieBody.count)).toBe(true);
    expect(badCookieBody.count).toBe(items.length);
  } finally {
    await anonymous.dispose();
    await bogus.dispose();
  }
});

test("reading the count twice gives the same answer and leaves the item list unchanged", async ({ request }) => {
  const before = await (await request.get(ITEMS_URL)).json();

  const first = await request.get(COUNT_URL);
  const second = await request.get(COUNT_URL);
  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);
  const firstCount = (await first.json()).count;
  expect((await second.json()).count).toBe(firstCount);
  expect(firstCount).toBe(before.length);

  const after = await (await request.get(ITEMS_URL)).json();
  expect(after).toEqual(before);
});
