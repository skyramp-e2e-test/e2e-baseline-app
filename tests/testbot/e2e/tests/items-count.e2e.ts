// GET /api/items/count: answers {"count": <integer>} with the number of items stored,
// readable without signing in, the same way GET /api/items is.
import { test, expect, APIRequestContext } from "@playwright/test";

const APP_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// Items have no delete route, so every item these tests create stays; the prefix finds them.
const uniqueName = (label: string) =>
  `count-probe-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function getCount(request: APIRequestContext, headers: Record<string, string> = {}) {
  const res = await request.get(`${APP_URL}/api/items/count`, { headers });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  return (await res.json()) as { count: number };
}

async function listItems(request: APIRequestContext) {
  const res = await request.get(`${APP_URL}/api/items`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Array<{ id: number; name: string; created_at: string }>;
}

// Reads the list, the count, then the list again, until the list did not change in between,
// so a write made by another test at the same time cannot make the comparison wrong.
async function countBesideList(request: APIRequestContext) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await listItems(request);
    const { count } = await getCount(request);
    const after = await listItems(request);
    if (before.length === after.length) return { count, listed: after };
  }
  throw new Error("the item list kept changing while the count was read");
}

async function createItem(request: APIRequestContext, name: string) {
  const res = await request.post(`${APP_URL}/api/items`, { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body as { id: number; name: string };
}

test.describe("GET /api/items/count", () => {
  test("count equals the number of items GET /api/items lists", async ({ request }) => {
    // A fresh app may hold no items: make sure there is at least one to count.
    await createItem(request, uniqueName("match"));
    const { count, listed } = await countBesideList(request);
    expect(listed.length).toBeGreaterThan(0);
    expect(count).toBe(listed.length);
  });

  test("count rises by exactly one for each created item and still equals the list length", async ({ request }) => {
    const c0 = (await getCount(request)).count;

    const first = await createItem(request, uniqueName("inc-a"));
    const c1 = (await getCount(request)).count;
    const listAfterFirst = await listItems(request);
    expect(listAfterFirst.map((i) => i.name)).toContain(first.name);
    expect.soft(c1).toBe(c0 + 1);

    const second = await createItem(request, uniqueName("inc-b"));
    const c2 = (await getCount(request)).count;
    expect((await listItems(request)).map((i) => i.name)).toContain(second.name);
    expect.soft(c2).toBe(c1 + 1);

    const { count, listed } = await countBesideList(request);
    expect(count).toBe(listed.length);
  });

  test("a refused create leaves the count unchanged", async ({ request }) => {
    await createItem(request, uniqueName("refused"));
    const c0 = (await getCount(request)).count;

    const blank = await request.post(`${APP_URL}/api/items`, { data: { name: "   " } });
    expect(blank.status()).toBe(400);
    expect(await blank.json()).toEqual({ error: "name is required" });

    const missing = await request.post(`${APP_URL}/api/items`, { data: {} });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "name is required" });

    const c1 = (await getCount(request)).count;
    expect.soft(c1).toBe(c0);

    const { count, listed } = await countBesideList(request);
    expect(count).toBe(listed.length);
  });

  test("count is a JSON integer, not a string", async ({ request }) => {
    const res = await request.get(`${APP_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["count"]);
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  test("count is readable without signing in and the same when signed in", async ({ request, playwright }) => {
    const email = process.env.SKYRAMP_UI_USERNAME;
    const password = process.env.SKYRAMP_UI_PASSWORD;
    if (!email || !password) throw new Error("SKYRAMP_UI_USERNAME and SKYRAMP_UI_PASSWORD must be set");

    // Sign in through the login form and take the session cookie it sets.
    const signedIn = await playwright.request.newContext();
    try {
      const login = await signedIn.post(`${APP_URL}/login`, { form: { email, password }, maxRedirects: 0 });
      expect(login.status()).toBe(303);
      expect(login.headers()["location"]).toBe("/items");
      const me = await signedIn.get(`${APP_URL}/api/me`);
      expect(me.status()).toBe(200);

      // The anonymous context sends no cookie at all.
      const anonymousMe = await request.get(`${APP_URL}/api/me`);
      expect(anonymousMe.status()).toBe(401);

      await expect
        .poll(async () => {
          const anonymous = await request.get(`${APP_URL}/api/items/count`);
          const withSession = await signedIn.get(`${APP_URL}/api/items/count`);
          return {
            anonymousStatus: anonymous.status(),
            sessionStatus: withSession.status(),
            same: JSON.stringify(await anonymous.json()) === JSON.stringify(await withSession.json()),
          };
        })
        .toEqual({ anonymousStatus: 200, sessionStatus: 200, same: true });
    } finally {
      await signedIn.dispose();
    }
  });

  test("count is not one more than the items stored after a create", async ({ request }) => {
    const created = await createItem(request, uniqueName("offbyone"));
    const { count, listed } = await countBesideList(request);
    expect(listed.map((i) => i.name)).toContain(created.name);
    expect(count).toBe(listed.length);
  });
});
