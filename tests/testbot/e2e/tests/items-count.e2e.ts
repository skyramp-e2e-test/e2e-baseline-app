// Contract tests for GET /api/items/count: it answers {"count": <integer>}, the number of stored items.
import { test, expect, request as playwrightRequest, APIRequestContext } from "@playwright/test";
import { randomUUID } from "crypto";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// Items the app has no route to delete carry this prefix, so they can be found afterwards.
const PROBE_PREFIX = "count-probe-";

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;

test.beforeAll(async () => {
  const extraHTTPHeaders: Record<string, string> = {};
  if (process.env.SKYRAMP_TEST_TOKEN) extraHTTPHeaders.Authorization = `Bearer ${process.env.SKYRAMP_TEST_TOKEN}`;
  api = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders });
});

test.afterAll(async () => {
  await api.dispose();
});

async function readCount(ctx: APIRequestContext = api, path = "/api/items/count") {
  const res = await ctx.get(path);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  return (await res.json()) as Record<string, unknown>;
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const res = await api.get("/api/items");
  expect(res.status()).toBe(200);
  return res.json();
}

async function createItem(name: string) {
  const res = await api.post("/api/items", { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body as { id: number; name: string };
}

test("count equals the number of items the list returns, as the only key", async () => {
  const seeded = await createItem(`${PROBE_PREFIX}${randomUUID()}`);

  const before = await listItems();
  const body = await readCount();
  const after = await listItems();

  expect(before.map((i) => i.id)).toContain(seeded.id);
  // No other writes in between: the list read just before and after agree.
  expect(after.length).toBe(before.length);
  expect(body).toEqual({ count: before.length });
  expect(Object.keys(body)).toEqual(["count"]);
});

test("count is a JSON integer, not a string", async () => {
  const body = await readCount();
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count as number).toBeGreaterThanOrEqual(0);
});

test("count goes up by exactly one for each item created", async () => {
  const c0 = (await readCount()).count as number;

  const first = await createItem(`${PROBE_PREFIX}${randomUUID()}`);
  const c1 = (await readCount()).count;
  expect(c1).toBe(c0 + 1);

  const second = await createItem(`${PROBE_PREFIX}${randomUUID()}`);
  const third = await createItem(`${PROBE_PREFIX}${randomUUID()}`);
  const c2 = (await readCount()).count;
  expect(c2).toBe(c0 + 3);

  const items = await listItems();
  expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([first.id, second.id, third.id]));
  expect(c2).toBe(items.length);
});

test("a refused create does not change the count", async () => {
  const c0 = (await readCount()).count;

  const missing = await api.post("/api/items", { data: {} });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "name is required" });

  const blank = await api.post("/api/items", { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toEqual({ error: "name is required" });

  const c1 = (await readCount()).count;
  expect(c1).toBe(c0);
});

test("count is readable without signing in and signed-in callers get the same answer", async () => {
  const email = process.env.SKYRAMP_UI_USERNAME;
  const password = process.env.SKYRAMP_UI_PASSWORD;
  expect(email, "SKYRAMP_UI_USERNAME must name the seeded user").toBeTruthy();
  expect(password, "SKYRAMP_UI_PASSWORD must hold the seeded user's password").toBeTruthy();

  const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const signedIn = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const anonBody = await readCount(anon);

    const login = await signedIn.post("/login", {
      form: { email: email as string, password: password as string },
      maxRedirects: 0,
    });
    expect(login.status()).toBe(303);
    expect(login.headers()["location"]).toBe("/items");
    const me = await signedIn.get("/api/me");
    expect(me.status()).toBe(200);

    const signedInBody = await readCount(signedIn);
    expect(signedInBody).toEqual({ count: anonBody.count });
    expect(typeof anonBody.count).toBe("number");
  } finally {
    await anon.dispose();
    await signedIn.dispose();
  }
});

test("query strings do not change the count", async () => {
  const plain = await readCount();
  const withQuery = await readCount(api, "/api/items/count?limit=1&name=x");
  expect(withQuery).toEqual({ count: plain.count });
  expect(typeof plain.count).toBe("number");
});
