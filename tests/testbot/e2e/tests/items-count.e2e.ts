import { test, expect, request, APIRequestContext, APIResponse } from "@playwright/test";
import { randomUUID } from "crypto";

// Functional tests for GET /api/items/count: {"count": <integer>}, consistent with GET /api/items.
const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The tests in this file read and change the shared item count, so they run one after another.
test.describe.configure({ mode: "serial" });

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await api.dispose();
});

async function readCount(ctx: APIRequestContext = api): Promise<{ response: APIResponse; count: unknown }> {
  const response = await ctx.get("/api/items/count");
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { response, count: body.count };
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const response = await api.get("/api/items");
  expect(response.status()).toBe(200);
  return response.json();
}

async function createItem(name: string): Promise<{ id: number; name: string }> {
  const response = await api.post("/api/items", { data: { name } });
  expect(response.status()).toBe(201);
  const created = await response.json();
  expect(created.name).toBe(name);
  return created;
}

test("count equals the number of items the list returns", async () => {
  // Read list, count, list: when both list reads agree, nothing was added in between.
  let listLength = -1;
  let body: unknown;
  let response: APIResponse | undefined;
  await expect
    .poll(async () => {
      const before = (await listItems()).length;
      response = await api.get("/api/items/count");
      body = await response.json();
      const after = (await listItems()).length;
      listLength = before;
      return before === after;
    })
    .toBe(true);
  expect(response!.status()).toBe(200);
  expect(response!.headers()["content-type"]).toContain("application/json");
  expect(Object.keys(body as object)).toEqual(["count"]);
  expect(body).toEqual({ count: listLength });
});

test("creating an item raises the count by exactly one each time", async () => {
  const { count: c0 } = await readCount();
  expect(typeof c0).toBe("number");
  const start = c0 as number;

  const first = await createItem(`count-probe-${randomUUID()}`);
  const { count: c1 } = await readCount();
  expect(c1).toBe(start + 1);
  const listAfterFirst = await listItems();
  expect(listAfterFirst).toHaveLength(start + 1);
  expect(listAfterFirst.map((i) => i.id)).toContain(first.id);

  const second = await createItem(`count-probe-${randomUUID()}`);
  const { count: c2 } = await readCount();
  expect(c2).toBe(start + 2);
  const listAfterSecond = await listItems();
  expect(listAfterSecond).toHaveLength(start + 2);
  expect(listAfterSecond.map((i) => i.id)).toEqual(expect.arrayContaining([first.id, second.id]));
});

test("a rejected item creation leaves the count unchanged", async () => {
  const { count: c0 } = await readCount();

  const blank = await api.post("/api/items", { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toEqual({ error: "name is required" });

  const empty = await api.post("/api/items", { data: {} });
  expect(empty.status()).toBe(400);
  expect(await empty.json()).toEqual({ error: "name is required" });

  const { count: after } = await readCount();
  expect(after).toBe(c0);
  expect(await listItems()).toHaveLength(c0 as number);
});

test("count is a JSON integer number, not a string", async () => {
  const response = await api.get("/api/items/count");
  expect(response.status()).toBe(200);
  const raw = await response.text();
  // The raw JSON carries a number literal, not a quoted bigint string.
  expect(raw).toMatch(/^\{"count":\d+\}$/);
  const body = JSON.parse(raw);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);
});

test("count is readable without signing in and with a session", async () => {
  const { count: anonymous } = await readCount();
  expect(typeof anonymous).toBe("number");

  const email = process.env.SKYRAMP_UI_USERNAME;
  const password = process.env.SKYRAMP_UI_PASSWORD;
  if (!email || !password) throw new Error("SKYRAMP_UI_USERNAME and SKYRAMP_UI_PASSWORD must be set to sign in");

  const signedIn = await request.newContext({ baseURL: BASE_URL });
  try {
    const login = await signedIn.post("/login", { form: { email, password }, maxRedirects: 0 });
    expect(login.status()).toBe(303);
    expect(login.headers()["location"]).toBe("/items");
    const me = await signedIn.get("/api/me");
    expect(me.status()).toBe(200);

    const { count: withSession } = await readCount(signedIn);
    expect(withSession).toBe(anonymous);
  } finally {
    await signedIn.dispose();
  }
});
