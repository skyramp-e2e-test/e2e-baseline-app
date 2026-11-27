// GET /api/items/count: the number of stored items, as JSON {"count": <integer>}.
import { test, expect, APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

type Item = { id: number; name: string; created_at: string };
type Snapshot = { count: number; items: Item[] };

async function listItems(request: APIRequestContext): Promise<Item[]> {
  const res = await request.get(`${BASE_URL}/api/items`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Item[];
}

async function readCount(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BASE_URL}/api/items/count`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  return body.count;
}

// Reads the count between two reads of the list. Other tests may add items meanwhile,
// so it retries until the list did not change around the count read.
async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const before = await listItems(request);
    const count = await readCount(request);
    const after = await listItems(request);
    if (before.length === after.length) return { count, items: after };
  }
  throw new Error("items kept changing while reading the count");
}

// Items that appeared between two snapshots and were not made by this test.
function othersAdded(before: Snapshot, after: Snapshot, mine: number[]): number {
  const seen = new Set(before.items.map((i) => i.id));
  return after.items.filter((i) => !seen.has(i.id) && !mine.includes(i.id)).length;
}

async function createItem(request: APIRequestContext, name: string): Promise<Item> {
  const res = await request.post(`${BASE_URL}/api/items`, { data: { name } });
  expect(res.status()).toBe(201);
  const item = (await res.json()) as Item;
  expect(item.name).toBe(name);
  return item;
}

const unique = (label: string) => `count-probe-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe.configure({ mode: "serial" });

test.describe("GET /api/items/count", () => {
  test("without a session returns 200 JSON {count} equal to the number of listed items", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");

    const snap = await snapshot(request);
    expect(snap.count).toBe(snap.items.length);
  });

  test("count is a non-negative integer JSON number, not a string", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/items/count`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(0);
    // The raw body carries a JSON number: no quotes around the value.
    expect(await res.text()).toMatch(/^\{"count":\d+\}$/);
  });

  test("rises by exactly one after a successful create", async ({ request }) => {
    const before = await snapshot(request);
    const name = unique("one");
    const item = await createItem(request, name);
    const after = await snapshot(request);

    expect(after.items.filter((i) => i.name === name).map((i) => i.id)).toEqual([item.id]);
    expect(after.count).toBe(before.count + 1 + othersAdded(before, after, [item.id]));
    expect(after.count).toBe(after.items.length);
  });

  test("stays unchanged when a create is refused with 400", async ({ request }) => {
    const bodies: unknown[] = [{ name: "   " }, {}, { name: 123 }, { name: null }, { name: "" }];
    for (const data of bodies) {
      const before = await snapshot(request);
      const res = await request.post(`${BASE_URL}/api/items`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
      expect(await res.json()).toEqual({ error: "name is required" });
      const after = await snapshot(request);
      expect(after.count, JSON.stringify(data)).toBe(before.count + othersAdded(before, after, []));
      expect(after.count).toBe(after.items.length);
    }
  });

  test("rises by exactly three after three creates", async ({ request }) => {
    const before = await snapshot(request);
    const made: Item[] = [];
    for (let i = 0; i < 3; i++) made.push(await createItem(request, unique(`three-${i}`)));
    const after = await snapshot(request);

    const ids = made.map((i) => i.id);
    expect(after.items.filter((i) => ids.includes(i.id)).map((i) => i.id).sort()).toEqual([...ids].sort());
    expect(after.count).toBe(before.count + 3 + othersAdded(before, after, ids));
    expect(after.count).toBe(after.items.length);
  });
});
