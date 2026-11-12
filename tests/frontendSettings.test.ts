import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { Frontend } from "@91/client";
import { act, fireEvent, render, within } from "./helpers/dom";
import { FrontendSettingsSection } from "../src/admin/settings/FrontendSettingsSection";

const frontends: Frontend[] = [
  { id: "", name: "91-web-nostalgic", version: "1.0.0", repository: "https://github.com/nianzhibai/91-web-nostalgic", builtin: true, active: true },
  { id: "91-web@1.0.0", name: "91-web", version: "1.0.0", repository: "https://github.com/nianzhibai/91-web", builtin: true, active: false },
  { id: "community@0.3.0", name: "community", version: "0.3.0", repository: "https://github.com/community/web", builtin: false, active: false },
  { id: "local@0.1.0", name: "local", version: "0.1.0", builtin: false, active: false },
];

type Call = { method: string; path: string; body?: unknown };

// Answers the frontend API; `write` decides the result of every POST.
function mockAPI(t: test.TestContext, options: { list?: Frontend[]; updates?: { name: string; version: string }[]; write?: (call: Call) => Response | Promise<Response> } = {}) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const call = { method: init?.method || "GET", path: input, body: init?.body };
    calls.push(call);
    if (call.method === "POST") return options.write ? options.write(call) : Response.json({ frontends: options.list ?? frontends });
    if (input.endsWith("/updates")) return Response.json({ updates: options.updates ?? [] });
    return Response.json({ frontends: options.list ?? frontends });
  });
  return calls;
}

async function renderSection() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection)); });
  return view;
}

const writes = (calls: Call[]) => calls.filter(call => call.method === "POST").map(call => [call.path, call.body]);

test("every frontend is listed once with its source and the active one is marked", async t => {
  const calls = mockAPI(t);
  const view = await renderSection();
  const rows = within(view.getByRole("list", { name: "可用的前端" })).getAllByRole("listitem");
  assert.deepEqual(rows.map(row => row.textContent), [
    "91-web-nostalgicv1.0.0 · 内置使用中",
    "91-webv1.0.0 · 内置使用",
    "communityv0.3.0 · github.com/community/web使用",
    "localv0.1.0 · 本地上传使用",
  ]);
  assert.equal(within(rows[0]).queryByRole("button"), null);
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`).sort(), ["GET /admin/api/frontend", "GET /admin/api/frontend/updates"]);
  // Choosing a frontend is independent of the configuration file.
  assert.equal(view.queryByRole("button", { name: /启用|检查更新/ }), null);
});

test("switching to a builtin frontend takes one click and no download", async t => {
  const calls = mockAPI(t);
  const view = await renderSection();
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "使用 91-web" })); });
  assert.equal(view.queryByRole("dialog"), null);
  assert.deepEqual(writes(calls), [["/admin/api/frontend/activate", '{"id":"91-web@1.0.0"}']]);
  // The page stays busy while the browser opens the selected frontend.
  assert.equal(view.getByRole("button", { name: "使用 community" }).hasAttribute("disabled"), true);
});

test("switching to a third-party frontend is confirmed and failures keep the current one", async t => {
  const calls = mockAPI(t, { write: () => Response.json({ error: "frontend requires API >= 2.0.0" }, { status: 400 }) });
  const view = await renderSection();
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "使用 community" })); });
  const dialog = view.getByRole("dialog");
  assert.match(dialog.textContent || "", /切换到 community？/);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); });
  assert.deepEqual(writes(calls), []);

  await act(async () => { fireEvent.click(view.getByRole("button", { name: "使用 community" })); });
  await act(async () => { fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "切换" })); });
  assert.deepEqual(writes(calls), [["/admin/api/frontend/activate", '{"id":"community@0.3.0"}']]);
  assert.equal(view.queryByRole("dialog"), null);
  assert.match(view.getByRole("alert").textContent || "", /frontend requires API/);
  assert.equal(view.getByRole("button", { name: "使用 community" }).hasAttribute("disabled"), false);
});

test("a GitHub repository is installed once after confirmation", async t => {
  let complete!: (response: Response) => void;
  const calls = mockAPI(t, { write: () => new Promise<Response>(resolve => { complete = resolve; }) });
  const view = await renderSection();
  const input = view.getByLabelText("添加前端") as HTMLInputElement;
  const install = view.getByRole("button", { name: "安装" });
  assert.equal(install.hasAttribute("disabled"), true);
  fireEvent.change(input, { target: { value: "owner/web" } });
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(install.hasAttribute("disabled"), true);

  fireEvent.change(input, { target: { value: "https://github.com/owner/web" } });
  // Enter adds the repository instead of submitting the surrounding settings form.
  const submitted = !fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(submitted, true);
  const dialog = view.getByRole("dialog");
  assert.match(dialog.textContent || "", /安装并切换到 owner\/web？/);
  await act(async () => {
    const confirm = within(dialog).getByRole("button", { name: "安装并切换" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  assert.deepEqual(writes(calls), [["/admin/api/frontend/install", '{"repository":"https://github.com/owner/web"}']]);
  await act(async () => { complete(Response.json({ error: "release must contain frontend.tar.gz" }, { status: 400 })); });
  assert.match(view.getByRole("alert").textContent || "", /frontend\.tar\.gz/);
  assert.equal(input.value, "https://github.com/owner/web");
});

test("a repository that is already installed is switched to without downloading", async t => {
  const calls = mockAPI(t);
  const view = await renderSection();
  const input = view.getByLabelText("添加前端");
  fireEvent.change(input, { target: { value: "https://github.com/nianzhibai/91-web.git" } });
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "安装" })); });
  assert.deepEqual(writes(calls), [["/admin/api/frontend/activate", '{"id":"91-web@1.0.0"}']]);
});

test("the active repository reports it is already in use", async t => {
  const calls = mockAPI(t);
  const view = await renderSection();
  fireEvent.change(view.getByLabelText("添加前端"), { target: { value: "https://github.com/Nianzhibai/91-web-nostalgic/" } });
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "安装" })); });
  assert.deepEqual(writes(calls), []);
  assert.equal(view.getByRole("alert").textContent, "91-web-nostalgic 正在使用");
});

test("a locally built package is uploaded after confirmation", async t => {
  const calls = mockAPI(t);
  const view = await renderSection();
  const file = new File(["archive"], "frontend.tar.gz", { type: "application/gzip" });
  const picker = view.getByLabelText("上传前端安装包") as HTMLInputElement;
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  fireEvent.change(picker);
  const dialog = view.getByRole("dialog");
  assert.match(dialog.textContent || "", /安装并切换到 frontend\.tar\.gz？/);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "安装并切换" })); });
  assert.deepEqual(writes(calls), [["/admin/api/frontend/upload", file]]);
});

test("only the active frontend offers its available update", async t => {
  const calls = mockAPI(t, { updates: [{ name: "91-web-nostalgic", version: "1.1.0" }, { name: "community", version: "0.4.0" }] });
  const view = await renderSection();
  assert.equal(view.queryByRole("button", { name: "更新到 v0.4.0" }), null);
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "更新到 v1.1.0" })); });
  assert.equal(view.queryByRole("dialog"), null);
  assert.deepEqual(writes(calls), [["/admin/api/frontend/install", '{"repository":"https://github.com/nianzhibai/91-web-nostalgic"}']]);
});

test("a failed list can be retried and a failed update check offers nothing", async t => {
  let fail = true;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.endsWith("/updates")) return Response.json({ error: "rate limited" }, { status: 502 });
    return fail ? Response.json({ error: "读取失败" }, { status: 500 }) : Response.json({ frontends });
  });
  const view = await renderSection();
  assert.match(view.container.textContent || "", /读取失败/);
  fail = false;
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "重新读取" })); });
  assert.equal(within(view.getByRole("list", { name: "可用的前端" })).getAllByRole("listitem").length, 4);
  assert.equal(view.queryByRole("button", { name: /更新到/ }), null);
});
