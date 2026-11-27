// Contract tests for GET /api/items/count: it answers {"count": <integer>}, the number of
// items GET /api/items lists. Requests go through the Skyramp client.
import { test, expect } from "@playwright/test";
import { SkyrampClient, ResponseV2, getResponseValue, uniqueSuffix } from "@skyramp/skyramp";

const URL_BASE = process.env.SKYRAMP_TEST_SERVICE_URL_APP || "http://localhost:3000";

const client = new SkyrampClient();

function body(response: ResponseV2): unknown {
  return JSON.parse((response as any).responseBody);
}

function status(response: ResponseV2): number {
  return (response as any).statusCode;
}

async function getCount(options: { cookies?: { [name: string]: string }; queryParams?: { [name: string]: string } } = {}) {
  const response = await client.sendRequest({
    url: URL_BASE,
    path: "/api/items/count",
    method: "GET",
    ...options,
  });
  return response;
}

async function readCount(): Promise<number> {
  const response = await getCount();
  expect(status(response)).toBe(200);
  const count = getResponseValue(response, "count");
  expect(typeof count).toBe("number");
  return count as number;
}

async function listItems(): Promise<Array<{ id: number; name: string }>> {
  const response = await client.sendRequest({ url: URL_BASE, path: "/api/items", method: "GET" });
  expect(status(response)).toBe(200);
  const items = body(response);
  expect(Array.isArray(items)).toBe(true);
  return items as Array<{ id: number; name: string }>;
}

async function createItem(name: string) {
  return client.sendRequest({
    url: URL_BASE,
    path: "/api/items",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

test.describe("GET /api/items/count", () => {
  test("answers 200 with a JSON object whose only field is an integer count", async () => {
    const response = await getCount();
    expect(status(response)).toBe(200);
    const headers = (response as any).responseHeaders || {};
    const contentType = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
    expect(String(contentType)).toContain("application/json");
    const parsed = body(response) as { [key: string]: unknown };
    expect(Object.keys(parsed)).toEqual(["count"]);
    expect(typeof parsed.count).toBe("number");
    expect(Number.isInteger(parsed.count)).toBe(true);
    expect(parsed.count as number).toBeGreaterThanOrEqual(0);
  });

  test("equals the number of items GET /api/items lists", async () => {
    if ((await listItems()).length === 0) {
      const seeded = await createItem(uniqueSuffix("count-seed"));
      expect(status(seeded)).toBe(201);
    }
    const items = await listItems();
    const count = await readCount();
    expect(items.length).toBeGreaterThan(0);
    expect(count).toBe(items.length);
  });

  test("goes up by exactly one for each item created", async () => {
    const c0 = await readCount();

    const firstName = uniqueSuffix("count-probe");
    const first = await createItem(firstName);
    expect(status(first)).toBe(201);
    expect(getResponseValue(first, "name")).toBe(firstName);
    const c1 = await readCount();
    expect(c1).toBe(c0 + 1);
    expect(c1).toBe((await listItems()).length);

    const secondName = uniqueSuffix("count-probe");
    const second = await createItem(secondName);
    expect(status(second)).toBe(201);
    expect(getResponseValue(second, "name")).toBe(secondName);
    const c2 = await readCount();
    expect(c2).toBe(c0 + 2);
    const items = await listItems();
    expect(c2).toBe(items.length);
    expect(items.map((item) => item.name)).toEqual(expect.arrayContaining([firstName, secondName]));
  });

  test("does not change when a create is refused for a missing or blank name", async () => {
    const c0 = await readCount();

    const missing = await client.sendRequest({
      url: URL_BASE,
      path: "/api/items",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(status(missing)).toBe(400);
    expect(body(missing)).toEqual({ error: "name is required" });

    const blank = await createItem("   ");
    expect(status(blank)).toBe(400);
    expect(body(blank)).toEqual({ error: "name is required" });

    expect(await readCount()).toBe(c0);
  });

  test("is readable without signing in and gives the same count when signed in", async () => {
    const anonymous = await getCount();
    expect(status(anonymous)).toBe(200);
    const anonymousCount = getResponseValue(anonymous, "count");
    expect(Number.isInteger(anonymousCount)).toBe(true);

    const email = process.env.SKYRAMP_UI_USERNAME;
    const password = process.env.SKYRAMP_UI_PASSWORD;
    expect(email, "SKYRAMP_UI_USERNAME must name the seeded test user").toBeTruthy();
    expect(password, "SKYRAMP_UI_PASSWORD must hold the seeded test user's password").toBeTruthy();
    const login = await fetch(`${URL_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: email as string, password: password as string }).toString(),
      redirect: "manual",
    });
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/items");
    const session = /(?:^|[;,]\s*)session=([^;]+)/.exec(login.headers.get("set-cookie") || "")?.[1];
    expect(session, "sign-in sets a session cookie").toBeTruthy();

    const signedIn = await getCount({ cookies: { session: decodeURIComponent(session as string) } });
    expect(status(signedIn)).toBe(200);
    expect(body(signedIn)).toEqual({ count: anonymousCount });
  });

  test("ignores query string parameters", async () => {
    const plain = await getCount();
    expect(status(plain)).toBe(200);
    const withQuery = await getCount({ queryParams: { foo: "bar", limit: "1" } });
    expect(status(withQuery)).toBe(200);
    expect(body(withQuery)).toEqual({ count: getResponseValue(plain, "count") });
  });
});
