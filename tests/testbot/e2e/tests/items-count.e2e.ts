import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { SkyrampClient } from "@skyramp/skyramp";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://127.0.0.1:3000";

// Each test reads the store-wide count before and after its own writes, so the
// tests of this file run one after another.
test.describe.configure({ mode: "serial" });

const client = new SkyrampClient();

type Sent = { status: number | undefined; headers: Record<string, string>; body: any };

async function send(method: string, path: string, body?: unknown): Promise<Sent> {
  const response = await client.sendRequest({
    url: BASE_URL,
    path,
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
  const raw = (response as any).responseBody as string;
  return {
    status: (response as any).statusCode,
    headers: (response as any).responseHeaders || {},
    body: raw ? JSON.parse(raw) : undefined,
  };
}

async function readCount(): Promise<number> {
  const res = await send("GET", "/api/items/count");
  expect(res.status).toBe(200);
  expect(typeof res.body.count).toBe("number");
  expect(Number.isInteger(res.body.count)).toBe(true);
  return res.body.count;
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const res = await send("GET", "/api/items");
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  return res.body;
}

test("item count answers a JSON integer equal to the number of listed items", async () => {
  const before = await listItems();
  const res = await send("GET", "/api/items/count");
  const after = await listItems();

  expect(res.status).toBe(200);
  expect(res.headers["Content-Type"]).toContain("application/json");
  expect(Object.keys(res.body)).toEqual(["count"]);
  expect(typeof res.body.count).toBe("number");
  expect(Number.isInteger(res.body.count)).toBe(true);
  expect(res.body.count).toBeGreaterThanOrEqual(0);
  // The list did not change around the count, so it is the number stored at that moment.
  expect(after.length).toBe(before.length);
  expect(res.body.count).toBe(before.length);
});

test("item count rises by exactly one for each created item", async () => {
  const c0 = await readCount();

  const firstName = `count-probe-${randomUUID()}`;
  const first = await send("POST", "/api/items", { name: firstName });
  expect(first.status).toBe(201);
  expect(first.body.name).toBe(firstName);

  const c1 = await readCount();
  expect(c1).toBe(c0 + 1);
  const listAfterFirst = await listItems();
  expect(listAfterFirst.length).toBe(c1);
  expect(listAfterFirst.filter((i) => i.name === firstName)).toHaveLength(1);

  const secondName = `count-probe-${randomUUID()}`;
  const second = await send("POST", "/api/items", { name: secondName });
  expect(second.status).toBe(201);
  expect(second.body.name).toBe(secondName);

  const c2 = await readCount();
  expect(c2).toBe(c0 + 2);
  const listAfterSecond = await listItems();
  expect(listAfterSecond.length).toBe(c2);
  expect(listAfterSecond.filter((i) => i.name === secondName)).toHaveLength(1);
});

test("item count is unchanged by a create refused for a missing or blank name", async () => {
  const c0 = await readCount();

  const missing = await send("POST", "/api/items", {});
  expect(missing.status).toBe(400);
  expect(missing.body).toEqual({ error: "name is required" });

  const blank = await send("POST", "/api/items", { name: "   " });
  expect(blank.status).toBe(400);
  expect(blank.body).toEqual({ error: "name is required" });

  const c1 = await readCount();
  expect(c1).toBe(c0);
  expect((await listItems()).length).toBe(c1);
});
