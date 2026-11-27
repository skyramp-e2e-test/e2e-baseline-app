// GET /api/items/count: the number of stored items, as JSON {"count": <integer>}.
import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { SkyrampClient } from "@skyramp/skyramp";
// The account the app seeds at start (src/db.js seedTestUser).
import { TEST_USER } from "../../../../src/db";

const BASE_URL = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

const client = new SkyrampClient();

type Item = { id: number; name: string; created_at: string };

function headerValue(headers: { [name: string]: string } | undefined, name: string): string {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers![key]) : "";
}

async function getCount(cookies?: { [name: string]: string }) {
  const res = await client.sendRequest({ url: BASE_URL, path: "/api/items/count", method: "GET", cookies });
  return { status: res.statusCode, headers: res.responseHeaders, body: JSON.parse(res.responseBody) };
}

async function listItems(): Promise<Item[]> {
  const res = await client.sendRequest({ url: BASE_URL, path: "/api/items", method: "GET" });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.responseBody) as Item[];
}

async function createItem(body: object) {
  const res = await client.sendRequest({
    url: BASE_URL,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.responseBody) };
}

test.describe("GET /api/items/count", () => {
  test("answers 200 JSON with the count of stored items, 0 when there are none", async () => {
    // On a fresh database the list is [] and this asserts exactly {"count": 0}.
    const items = await listItems();
    const res = await getCount();
    expect(res.status).toBe(200);
    expect(headerValue(res.headers, "content-type")).toMatch(/^application\/json/);
    expect(res.body).toStrictEqual({ count: items.length });
    expect(typeof res.body.count).toBe("number");
  });

  test("count equals the number of listed items and is a JSON integer", async () => {
    const names = [1, 2, 3].map((n) => `count-${n}-${randomUUID()}`);
    for (const name of names) {
      const created = await createItem({ name });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe(name);
    }
    const items = await listItems();
    const res = await getCount();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["count"]);
    expect(typeof res.body.count).toBe("number");
    expect(Number.isInteger(res.body.count)).toBe(true);
    for (const name of names) expect(items.map((i) => i.name)).toContain(name);
    expect(res.body.count).toBe(items.length);
  });

  test("a create raises the count by one; refused creates and reads leave it unchanged", async () => {
    const before = await getCount();
    expect(before.status).toBe(200);
    const n: number = before.body.count;

    const name = `inc-${randomUUID()}`;
    const created = await createItem({ name });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe(name);
    const afterCreate = await getCount();
    expect(afterCreate.status).toBe(200);
    expect(afterCreate.body).toStrictEqual({ count: n + 1 });

    const blank = await createItem({ name: "   " });
    expect(blank.status).toBe(400);
    expect(blank.body).toStrictEqual({ error: "name is required" });
    const missing = await createItem({});
    expect(missing.status).toBe(400);
    expect(missing.body).toStrictEqual({ error: "name is required" });
    const afterRefused = await getCount();
    expect(afterRefused.status).toBe(200);
    expect(afterRefused.body).toStrictEqual({ count: n + 1 });

    const again = await getCount();
    expect(again.status).toBe(200);
    expect(again.body).toStrictEqual({ count: n + 1 });
  });

  test("is readable without a session, with the same count as a signed-in user", async () => {
    const anonymous = await getCount();
    expect(anonymous.status).toBe(200);
    expect(Object.keys(anonymous.body)).toEqual(["count"]);
    expect(Number.isInteger(anonymous.body.count)).toBe(true);

    const login = await client.sendRequest({
      url: BASE_URL,
      path: "/login",
      method: "POST",
      formParams: { email: TEST_USER.email, password: TEST_USER.password },
    });
    expect(login.statusCode).toBe(303);
    expect(headerValue(login.responseHeaders, "location")).toBe("/items");
    const session = login.cookies?.session;
    expect(session).toBeTruthy();

    const signedIn = await getCount({ session: session! });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toStrictEqual({ count: anonymous.body.count });
  });
});
