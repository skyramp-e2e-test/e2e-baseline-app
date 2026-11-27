// GET /api/items/count: the number of stored items, as JSON {"count": <integer>}.
// Items have no delete route, so the items these tests create (names starting
// "count-probe-" or "count-burst-") stay in the app.
import { test, expect } from "@playwright/test";
import { SkyrampClient } from "@skyramp/skyramp";

const URL_BASE = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

const client = new SkyrampClient();

type Resp = { status: number; headers: Record<string, string>; body: any };

async function send(
  method: string,
  path: string,
  options: { body?: unknown; cookies?: Record<string, string> } = {},
): Promise<Resp> {
  const response = await client.sendRequest({
    url: URL_BASE,
    path,
    method,
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
    cookies: options.cookies,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.responseHeaders ?? {})) headers[k.toLowerCase()] = String(v);
  const text = response.responseBody ?? "";
  return { status: response.statusCode as number, headers, body: text ? JSON.parse(text) : undefined };
}

async function readCount(options: { cookies?: Record<string, string> } = {}): Promise<number> {
  const response = await send("GET", "/api/items/count", options);
  expect(response.status).toBe(200);
  expect(Object.keys(response.body)).toEqual(["count"]);
  expect(typeof response.body.count).toBe("number");
  expect(Number.isInteger(response.body.count)).toBe(true);
  return response.body.count;
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const response = await send("GET", "/api/items");
  expect(response.status).toBe(200);
  expect(Array.isArray(response.body)).toBe(true);
  return response.body;
}

const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test("count answers 200 with a JSON object whose count is a non-negative integer", async () => {
  const response = await send("GET", "/api/items/count");
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(Object.keys(response.body)).toEqual(["count"]);
  expect(typeof response.body.count).toBe("number");
  expect(Number.isInteger(response.body.count)).toBe(true);
  expect(response.body.count).toBeGreaterThanOrEqual(0);
});

test("count equals the length of the item list", async () => {
  const items = await listItems();
  const count = await readCount();
  expect(count).toBe(items.length);
});

test("each created item raises the count by exactly one", async () => {
  const id = runId();
  const c0 = await readCount();

  const first = await send("POST", "/api/items", { body: { name: `count-probe-${id}-1` } });
  expect(first.status).toBe(201);
  expect(first.body.name).toBe(`count-probe-${id}-1`);
  const c1 = await readCount();
  expect(c1).toBe(c0 + 1);

  const second = await send("POST", "/api/items", { body: { name: `count-probe-${id}-2` } });
  expect(second.status).toBe(201);
  expect(second.body.name).toBe(`count-probe-${id}-2`);
  const c2 = await readCount();
  expect(c2).toBe(c0 + 2);

  const items = await listItems();
  expect(items.filter((i) => i.name.startsWith(`count-probe-${id}-`)).map((i) => i.id).sort())
    .toEqual([first.body.id, second.body.id].sort());
  expect(c2).toBe(items.length);
});

test("a refused create leaves the count unchanged", async () => {
  const c0 = await readCount();

  const empty = await send("POST", "/api/items", { body: {} });
  expect(empty.status).toBe(400);
  expect(empty.body).toEqual({ error: "name is required" });

  const blank = await send("POST", "/api/items", { body: { name: "   " } });
  expect(blank.status).toBe(400);
  expect(blank.body).toEqual({ error: "name is required" });

  const c1 = await readCount();
  expect(c1).toBe(c0);
});

test("count is readable without signing in and gives the same answer with a session", async () => {
  const token = process.env.SKYRAMP_TEST_TOKEN;
  expect(token, "SKYRAMP_TEST_TOKEN (the session cookie value) must be set").toBeTruthy();

  const anonymous = await send("GET", "/api/items/count");
  expect(anonymous.status).toBe(200);
  const signedIn = await send("GET", "/api/items/count", { cookies: { session: token as string } });
  expect(signedIn.status).toBe(200);

  expect(Number.isInteger(anonymous.body.count)).toBe(true);
  expect(signedIn.body).toEqual({ count: anonymous.body.count });
});

test("repeated reads do not change the count", async () => {
  const first = await readCount();
  const second = await readCount();
  const third = await readCount();
  const items = await listItems();
  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(first).toBe(items.length);
});

test("count matches the list after a burst of concurrent creates", async () => {
  const id = runId();
  const c0 = await readCount();

  const names = Array.from({ length: 25 }, (_, i) => `count-burst-${id}-${i}`);
  const results = await Promise.all(names.map((name) => send("POST", "/api/items", { body: { name } })));
  const ok = results.filter((r) => r.status === 201).length;
  expect(ok).toBe(25);

  const c1 = await readCount();
  const items = await listItems();
  expect(items.filter((i) => i.name.startsWith(`count-burst-${id}-`)).map((i) => i.name).sort())
    .toEqual([...names].sort());
  expect(c1).toBe(c0 + ok);
  expect(c1).toBe(items.length);
});
