// API tests for GET /api/items/count: it answers {"count": <integer>}, the number of rows in items.
import { test, expect } from "@playwright/test";
import { SkyrampClient, ResponseV2, getBaseUrl, uniqueSuffix } from "@skyramp/skyramp";

const URL_VALUE = getBaseUrl("SKYRAMP_TEST_SERVICE_URL_APP", "http://localhost:3000");

// The tests read the item total before and after their own requests, so they run one after another.
test.describe.configure({ mode: "serial" });

const client = new SkyrampClient();

function body(response: ResponseV2) {
  return JSON.parse(response.responseBody);
}

function header(response: ResponseV2, name: string): string {
  const key = Object.keys(response.responseHeaders).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? (response.responseHeaders as Record<string, unknown>)[key] : "";
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

async function getCount(headers: Record<string, string> = {}): Promise<ResponseV2> {
  return client.sendRequest({ url: URL_VALUE, path: "/api/items/count", method: "GET", headers });
}

async function getItems(headers: Record<string, string> = {}): Promise<ResponseV2> {
  return client.sendRequest({ url: URL_VALUE, path: "/api/items", method: "GET", headers });
}

async function createItem(name: string): Promise<ResponseV2> {
  return client.sendRequest({
    url: URL_VALUE,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

// Signs in through the login form and returns the signed session cookie (name=value).
async function signIn(): Promise<string> {
  const form = new URLSearchParams({
    email: process.env.SKYRAMP_UI_USERNAME as string,
    password: process.env.SKYRAMP_UI_PASSWORD as string,
  });
  const res = await fetch(`${URL_VALUE}/login`, { method: "POST", body: form, redirect: "manual" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/items");
  const setCookie = res.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  expect(cookie.startsWith("session=")).toBe(true);
  return cookie;
}

test("count answers 200 with a JSON integer equal to the number of items", async () => {
  const items = await getItems();
  expect(items.statusCode).toBe(200);
  const count = await getCount();
  expect(count.statusCode).toBe(200);
  expect(header(count, "content-type")).toContain("application/json");
  const payload = body(count);
  expect(Object.keys(payload)).toEqual(["count"]);
  expect(typeof payload.count).toBe("number");
  expect(Number.isInteger(payload.count)).toBe(true);
  expect(payload.count).toBeGreaterThanOrEqual(0);
  expect(payload.count).toBe(body(items).length);
});

test("count goes up by one for each item created", async () => {
  const c0 = body(await getCount()).count;

  const firstName = uniqueSuffix("count-probe-a");
  const first = await createItem(firstName);
  expect(first.statusCode).toBe(201);
  expect(body(first).name).toBe(firstName);
  const c1 = await getCount();
  expect(c1.statusCode).toBe(200);
  expect(body(c1).count).toBe(c0 + 1);

  const secondName = uniqueSuffix("count-probe-b");
  const second = await createItem(secondName);
  expect(second.statusCode).toBe(201);
  expect(body(second).name).toBe(secondName);
  const c2 = await getCount();
  expect(c2.statusCode).toBe(200);
  expect(body(c2).count).toBe(c0 + 2);

  const items = body(await getItems());
  const names = items.map((i: { name: string }) => i.name);
  expect(names).toContain(firstName);
  expect(names).toContain(secondName);
  expect(items.length).toBe(body(c2).count);
});

test("a refused create leaves the count unchanged", async () => {
  const c0 = body(await getCount()).count;

  const blank = await createItem("   ");
  expect(blank.statusCode).toBe(400);
  expect(body(blank)).toEqual({ error: "name is required" });

  const missing = await client.sendRequest({
    url: URL_VALUE,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(missing.statusCode).toBe(400);
  expect(body(missing)).toEqual({ error: "name is required" });

  const after = await getCount();
  expect(after.statusCode).toBe(200);
  expect(body(after).count).toBe(c0);
});

test("count is readable without signing in and is the same when signed in", async () => {
  const items = await getItems();
  expect(items.statusCode).toBe(200);

  const anonymous = await getCount();
  expect(anonymous.statusCode).toBe(200);
  const anonymousCount = body(anonymous).count;
  expect(Number.isInteger(anonymousCount)).toBe(true);

  const cookie = await signIn();
  const signedIn = await getCount({ Cookie: cookie });
  expect(signedIn.statusCode).toBe(200);
  expect(body(signedIn)).toEqual({ count: anonymousCount });
});

test("reading the count changes neither the items nor the count", async () => {
  const a0 = await getItems();
  expect(a0.statusCode).toBe(200);
  const first = await getCount();
  const second = await getCount();
  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(200);
  const a1 = await getItems();
  expect(a1.statusCode).toBe(200);
  expect(body(second).count).toBe(body(first).count);
  expect(body(a1)).toEqual(body(a0));
  expect(body(first).count).toBe(body(a0).length);
});
