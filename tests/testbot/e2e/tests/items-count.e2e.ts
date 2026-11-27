// GET /api/items/count: the number of items stored, as JSON {"count": <integer>}.
// The items table is shared, so the cases that compare counts run serially in this file.
import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { SkyrampClient, getValue } from "@skyramp/skyramp";

const URL_VALUE = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

test.describe.configure({ mode: "serial" });

const client = new SkyrampClient();

function contentType(response: any): string {
  const headers = response.responseHeaders || {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-type");
  return key ? String(headers[key]) : "";
}

async function readCount(): Promise<number> {
  const response = await client.sendRequest({ url: URL_VALUE, path: "/api/items/count", method: "GET" });
  expect(response.statusCode).toBe(200);
  const count = getValue(response, "count");
  expect(typeof count).toBe("number");
  return count as number;
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const response = await client.sendRequest({ url: URL_VALUE, path: "/api/items", method: "GET" });
  expect(response.statusCode).toBe(200);
  const items = JSON.parse(response.responseBody as string);
  expect(Array.isArray(items)).toBe(true);
  return items;
}

async function createItem(name: string): Promise<{ id: number; name: string }> {
  const response = await client.sendRequest({
    url: URL_VALUE,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(response.statusCode).toBe(201);
  const item = JSON.parse(response.responseBody as string);
  expect(item.name).toBe(name);
  return item;
}

test("count answers 200 with a JSON body holding only an integer count, without signing in", async () => {
  // Sent with no session cookie.
  const response = await client.sendRequest({ url: URL_VALUE, path: "/api/items/count", method: "GET" });
  expect(response.statusCode).toBe(200);
  expect(contentType(response)).toContain("application/json");
  const body = JSON.parse(response.responseBody as string);
  expect(Object.keys(body)).toEqual(["count"]);
  expect(typeof body.count).toBe("number");
  expect(Number.isInteger(body.count)).toBe(true);
  expect(body.count).toBeGreaterThanOrEqual(0);

  // The item list the count counts is readable the same way.
  const list = await client.sendRequest({ url: URL_VALUE, path: "/api/items", method: "GET" });
  expect(list.statusCode).toBe(200);
});

test("count equals the number of items the list returns", async () => {
  const seed = await createItem(`count-seed-${randomUUID()}`);
  const items = await listItems();
  const count = await readCount();
  expect(items.map((item) => item.id)).toContain(seed.id);
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBe(items.length);
});

test("creating items raises the count by exactly one per item", async () => {
  const before = await readCount();

  const first = await createItem(`count-a-${randomUUID()}`);
  expect(await readCount()).toBe(before + 1);

  const second = await createItem(`count-b-${randomUUID()}`);
  expect(await readCount()).toBe(before + 2);

  const items = await listItems();
  expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  expect(items.length).toBe(before + 2);
});

test("a rejected create leaves the count unchanged", async () => {
  const before = await readCount();

  const missing = await client.sendRequest({
    url: URL_VALUE,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(missing.statusCode).toBe(400);
  expect(JSON.parse(missing.responseBody as string)).toEqual({ error: "name is required" });

  const blank = await client.sendRequest({
    url: URL_VALUE,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "   " }),
  });
  expect(blank.statusCode).toBe(400);
  expect(JSON.parse(blank.responseBody as string)).toEqual({ error: "name is required" });

  expect(await readCount()).toBe(before);
});
