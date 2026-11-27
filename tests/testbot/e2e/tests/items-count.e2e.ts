// Contract tests for GET /api/items/count and the items list beside it (GET /api/items).
import { test, expect, request as apiRequest, APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// These tests read the whole-table count, so they run one after another.
test.describe.configure({ mode: "serial" });

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await apiRequest.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await api.dispose();
});

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readCount(ctx: APIRequestContext, path = "/api/items/count"): Promise<number> {
  const res = await ctx.get(path);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);
  return body.count;
}

async function readItems(ctx: APIRequestContext): Promise<Array<{ id: number; name: string; created_at: string }>> {
  const res = await ctx.get("/api/items");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  return body;
}

async function createItem(ctx: APIRequestContext, name: string): Promise<{ id: number; name: string }> {
  const res = await ctx.post("/api/items", { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe(name);
  return body;
}

test("count is an integer equal to the items list length", async () => {
  const before = await readItems(api);
  const res = await api.get("/api/items/count");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(body).toEqual({ count: before.length });
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  const after = await readItems(api);
  expect(after.length).toBe(body.count);
});

test("count goes up by one for each created item", async () => {
  const c0 = await readCount(api);
  await createItem(api, uniqueName("count-probe"));
  const c1 = await readCount(api);
  expect(c1).toBe(c0 + 1);
  await createItem(api, uniqueName("count-probe"));
  const c2 = await readCount(api);
  expect(c2).toBe(c0 + 2);
  expect((await readItems(api)).length).toBe(c2);
});

test("rejected creates leave the count unchanged", async () => {
  const c0 = await readCount(api);
  for (const data of [{ name: "" }, { name: "   " }, {}, { name: 123 }]) {
    const res = await api.post("/api/items", { data });
    expect(res.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
    expect(await res.json()).toEqual({ error: "name is required" });
  }
  const c1 = await readCount(api);
  expect(c1).toBe(c0);
});

test("count is readable without signing in and matches the signed-in count", async () => {
  const anon = await apiRequest.newContext({ baseURL: BASE_URL });
  const signedIn = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const anonRes = await anon.get("/api/items/count");
    expect(anonRes.status()).toBe(200);
    const anonBody = await anonRes.json();
    expect(Number.isInteger(anonBody.count)).toBe(true);

    const login = await signedIn.post("/login", {
      form: { email: process.env.SKYRAMP_UI_USERNAME as string, password: process.env.SKYRAMP_UI_PASSWORD as string },
      maxRedirects: 0,
    });
    expect(login.status()).toBe(303);
    expect(login.headers()["location"]).toBe("/items");
    const me = await signedIn.get("/api/me");
    expect(me.status()).toBe(200);

    const signedRes = await signedIn.get("/api/items/count");
    expect(signedRes.status()).toBe(200);
    expect(await signedRes.json()).toEqual({ count: anonBody.count });
  } finally {
    await anon.dispose();
    await signedIn.dispose();
  }
});

test("count ignores query parameters", async () => {
  const c = await readCount(api);
  const filtered = await readCount(api, "/api/items/count?name=zzz&limit=1");
  expect(filtered).toBe(c);
});

test("items list still answers the full array ordered by id", async () => {
  const name = uniqueName("list-check");
  const created = await createItem(api, name);
  const res = await api.get("/api/items");
  expect(res.status()).toBe(200);
  const items = await res.json();
  expect(Array.isArray(items)).toBe(true);
  expect(items).not.toHaveProperty("count");
  const found = items.filter((i: { id: number }) => i.id === created.id);
  expect(found).toHaveLength(1);
  expect(found[0].name).toBe(name);
  expect(Object.keys(found[0]).sort()).toEqual(["created_at", "id", "name"]);
  const ids = items.map((i: { id: number }) => i.id);
  for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1]);
});
