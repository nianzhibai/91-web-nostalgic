import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { act, fireEvent, render } from "./helpers/dom";
import { ToastProvider } from "../src/components/ToastContext";
import { DriveQRLogin } from "../src/admin/drive/DriveQRLogin";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const LOGINS = "/admin/api/drive-logins";

function harness(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date("2026-10-23T12:00:00Z") });
  const starts: unknown[] = [];
  const cancels: string[] = [];
  const polls: { id: string; signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }[] = [];
  let sequence = 0;
  const fetch = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = init?.method ?? "GET";
    if (path === LOGINS && method === "POST") {
      starts.push(JSON.parse(String(init!.body)));
      return Response.json({
        id: `login-${++sequence}`,
        kind: "p115",
        qrImageDataUrl: "data:image/png;base64,test",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        intervalMs: 2000,
      }, { status: 201 });
    }
    const id = decodeURIComponent(path.slice(LOGINS.length + 1));
    if (method === "DELETE") {
      cancels.push(id);
      return new Response(null, { status: 204 });
    }
    const response = deferred<Response>();
    polls.push({ id, signal: init!.signal as AbortSignal, response });
    return response.promise;
  });
  let renderer: ReturnType<typeof render> | undefined;
  t.after(async () => { await act(async () => renderer?.unmount()); });
  const beginStart = () => { fireEvent.click(renderer!.container.querySelector("button.admin-btn")!); };
  return {
    starts, cancels, polls, fetch, beginStart,
    get root() { return renderer!.container; },
    get text() { return renderer!.container.textContent ?? ""; },
    render: async (onCredentials: (credentials: Record<string, string>) => void) => {
      const element = createElement(ToastProvider, null, createElement(DriveQRLogin, { kind: "p115", label: "115 网盘", onCredentials }));
      await act(async () => {
        if (renderer) renderer.rerender(element);
        else renderer = render(element);
      });
    },
    start: async () => { await act(async () => { beginStart(); }); },
    respond: async (index: number, response: Response) => { await act(async () => polls[index].response.resolve(response)); },
    tick: async (ms: number) => { await act(async () => t.mock.timers.tick(ms)); },
    unmount: async () => { await act(async () => renderer!.unmount()); },
  };
}

const success = (credentials: Record<string, string>) => Response.json({ state: "success", credentials, intervalMs: 2000 });

test("QR login keeps one poll in flight across rerenders, gives credentials to the latest callback and releases the login", async (t) => {
  const env = harness(t);
  const received: Record<string, string>[] = [];
  await env.render(() => assert.fail("A stale callback received credentials"));
  await env.start();
  assert.deepEqual(env.starts, [{ kind: "p115" }]);
  assert.equal(env.root.querySelector("img")!.getAttribute("alt"), "115 网盘扫码登录二维码");
  for (let i = 0; i < 5; i++) await env.render((credentials) => received.push(credentials));
  await env.tick(60_000);
  assert.equal(env.polls.length, 1);
  assert.equal(env.polls[0].signal.aborted, false);
  await env.respond(0, success({ cookie: "new-cookie" }));
  assert.deepEqual(received, [{ cookie: "new-cookie" }]);
  await env.tick(300_000);
  assert.equal(env.polls.length, 1);
  assert.deepEqual(env.cancels, ["login-1"]);
  assert.match(env.text, /登录成功/);
  assert.doesNotMatch(env.text, /已过期/);
});

test("QR polling waits for each response, follows the server interval and stops at a final state", async (t) => {
  const env = harness(t);
  await env.render(() => assert.fail("A rejected login returned credentials"));
  await env.start();
  await env.respond(0, Response.json({ state: "scanned", message: "已扫码，请在 115 App 确认登录", intervalMs: 5000 }));
  assert.match(env.text, /请在 115 App 确认登录/);
  await env.tick(4999);
  assert.equal(env.polls.length, 1);
  await env.tick(1);
  assert.equal(env.polls.length, 2);
  assert.equal(env.polls[1].id, "login-1");
  await env.tick(30_000);
  assert.equal(env.polls.length, 2);
  await env.respond(1, Response.json({ state: "rejected", intervalMs: 5000 }));
  await env.tick(300_000);
  assert.equal(env.polls.length, 2);
  assert.match(env.text, /已被拒绝或取消/);
  assert.deepEqual(env.cancels, ["login-1"]);
});

test("regenerating a QR code cancels the old login and ignores its late success", async (t) => {
  const env = harness(t);
  const received: Record<string, string>[] = [];
  await env.render((credentials) => received.push(credentials));
  await env.start();
  await env.start();
  assert.equal(env.polls.length, 2);
  assert.equal(env.polls[0].signal.aborted, true);
  assert.equal(env.polls[1].signal.aborted, false);
  assert.deepEqual(env.polls.map((poll) => poll.id), ["login-1", "login-2"]);
  assert.deepEqual(env.cancels, ["login-1"]);
  await env.respond(0, success({ cookie: "stale-cookie" }));
  assert.deepEqual(received, []);
  await env.respond(1, success({ access_token: "access", refresh_token: "refresh" }));
  assert.deepEqual(received, [{ access_token: "access", refresh_token: "refresh" }]);
});

test("a gateway error is shown concisely and the same login is polled again", async (t) => {
  const env = harness(t);
  const received: Record<string, string>[] = [];
  await env.render((credentials) => received.push(credentials));
  await env.start();
  await env.respond(0, new Response("<!DOCTYPE html><html>Bad gateway</html>", {
    status: 502, headers: { "Content-Type": "text/html" },
  }));
  assert.match(env.text, /网站服务暂时不可用（HTTP 502），请稍后重试/);
  assert.doesNotMatch(env.text, /<!DOCTYPE/);
  await env.tick(2000);
  assert.equal(env.polls.length, 2);
  assert.equal(env.polls[1].id, env.polls[0].id);
  await env.respond(1, success({ cookie: "recovered-cookie" }));
  assert.deepEqual(received, [{ cookie: "recovered-cookie" }]);
  assert.doesNotMatch(env.text, /HTTP 502/);
});

test("a login the server no longer knows is reported as expired", async (t) => {
  const env = harness(t);
  await env.render(() => assert.fail("A forgotten login returned credentials"));
  await env.start();
  await env.respond(0, Response.json({ code: "not_found", error: "login session not found" }, { status: 404 }));
  assert.match(env.text, /二维码已过期/);
  await env.tick(10_000);
  assert.equal(env.polls.length, 1);
});

test("QR expiry aborts a stalled poll without accepting its late success", async (t) => {
  const env = harness(t);
  await env.render(() => assert.fail("An expired login returned credentials"));
  await env.start();
  await env.tick(300_000);
  assert.equal(env.polls[0].signal.aborted, true);
  assert.match(env.text, /二维码已过期/);
  await env.respond(0, success({ cookie: "late-cookie" }));
  await env.tick(4000);
  assert.equal(env.polls.length, 1);
});

test("closing QR login aborts its poll and cancels the login on the server", async (t) => {
  const env = harness(t);
  await env.render(() => assert.fail("A closed login returned credentials"));
  await env.start();
  await env.unmount();
  assert.equal(env.polls[0].signal.aborted, true);
  assert.deepEqual(env.cancels, ["login-1"]);
  await env.respond(0, success({ cookie: "late-cookie" }));
  await env.tick(10_000);
  assert.equal(env.polls.length, 1);
});

test("closing QR login while generating cannot start a late poll", async (t) => {
  const env = harness(t);
  const generation = deferred<Response>();
  let signal!: AbortSignal;
  env.fetch.mock.mockImplementation(async (_input, init) => { signal = init!.signal as AbortSignal; return generation.promise; });
  await env.render(() => assert.fail("A closed login returned credentials"));
  await act(async () => { env.beginStart(); });
  await env.unmount();
  assert.equal(signal.aborted, true);
  await act(async () => generation.resolve(Response.json({
    id: "late", kind: "p115", qrImageDataUrl: "data:image/png;base64,test",
    expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalMs: 2000,
  }, { status: 201 })));
  assert.equal(env.fetch.mock.callCount(), 1);
});
