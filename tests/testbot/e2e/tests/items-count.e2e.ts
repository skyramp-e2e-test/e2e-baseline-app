// Contract tests for GET /api/items/count: it answers {"count": <integer>}, the number of items stored.
import { test, expect, request as playwrightRequest, APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

// The items API has no delete route, so items these tests create carry this prefix and stay in the app.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueName = (suffix: string) => `count-test-${RUN_ID}-${suffix}`;

// The tests read and change the shared item count, so they run one after another.
test.describe.configure({ mode: "serial" });

let api: APIRequestContext;

test.beforeAll(async () => {
  // A fresh context with no cookies: every request here is anonymous.
  api = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
});

test.afterAll(async () => {
  await api.dispose();
});

async function readCount(): Promise<number> {
  const response = await api.get("/api/items/count");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const response = await api.get("/api/items");
  expect(response.status()).toBe(200);
  return response.json();
}

test("GET /api/items/count answers anonymously with an integer count equal to the item list length", async () => {
  const items = await listItems();

  const response = await api.get("/api/items/count");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);
  expect(body.count).toBe(items.length);
});

test("creating an item raises the count by exactly one each time", async () => {
  const c0 = await readCount();

  const firstName = uniqueName("a");
  const first = await api.post("/api/items", { data: { name: firstName } });
  expect(first.status()).toBe(201);
  expect((await first.json()).name).toBe(firstName);

  const c1 = await readCount();
  expect(c1).toBe(c0 + 1);
  const itemsAfterFirst = await listItems();
  expect(itemsAfterFirst.length).toBe(c1);
  expect(itemsAfterFirst.map((i) => i.name)).toContain(firstName);

  const secondName = uniqueName("b");
  const second = await api.post("/api/items", { data: { name: secondName } });
  expect(second.status()).toBe(201);
  expect((await second.json()).name).toBe(secondName);

  const c2 = await readCount();
  expect(c2).toBe(c0 + 2);
  const itemsAfterSecond = await listItems();
  expect(itemsAfterSecond.length).toBe(c2);
  expect(itemsAfterSecond.map((i) => i.name)).toContain(secondName);
});

test("a refused create leaves the count unchanged", async () => {
  const c0 = await readCount();

  for (const data of [{}, { name: "" }, { name: "   " }, { name: 123 }]) {
    const response = await api.post("/api/items", { data });
    expect(response.status(), `POST /api/items ${JSON.stringify(data)}`).toBe(400);
    expect(await response.json()).toEqual({ error: "name is required" });
  }

  expect(await readCount()).toBe(c0);
  expect((await listItems()).length).toBe(c0);
});
