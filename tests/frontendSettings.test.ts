import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, fireEvent, render } from "./helpers/dom";
import { FrontendSettingsSection } from "../src/admin/settings/FrontendSettingsSection";

const props = {
  repository: "https://github.com/community/web",
  configurationSaved: true,
  disabled: false,
  onRepositoryChange() {},
};

test("frontend settings expose one install-and-activate action without version management", async t => {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes.push(input);
      assert.equal(init.body, undefined);
      return Response.json({ error: "最新发布与当前 API 不兼容" }, { status: 400 });
    }
    return Response.json({ active: "current@1.0.0", installed: [{ name: "old-web", version: "0.1.0" }] });
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  assert.equal((view.getByLabelText("前端仓库") as HTMLInputElement).value, props.repository);
  assert.ok(view.getByText("current@1.0.0"));
  assert.equal(view.queryByText("old-web"), null);
  assert.equal(view.queryByLabelText("发布版本"), null);
  assert.deepEqual(view.getAllByRole("button").map(button => button.textContent), ["安装并启用"]);
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "安装并启用" })); });
  assert.deepEqual(writes, ["/admin/api/frontend/install"]);
  assert.match(view.getByRole("alert").textContent || "", /最新发布与当前 API 不兼容/);
  assert.ok(view.getByText("current@1.0.0"));
});

test("installation is blocked until a valid repository has been saved", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ active: "", installed: [] }));
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, { ...props, configurationSaved: false })); });
  assert.equal(view.getByRole("button", { name: "安装并启用" }).hasAttribute("disabled"), true);
  view.rerender(createElement(FrontendSettingsSection, { ...props, repository: "community/web" }));
  assert.equal(view.getByLabelText("前端仓库").getAttribute("aria-invalid"), "true");
  assert.equal(view.getByRole("button", { name: "安装并启用" }).hasAttribute("disabled"), true);
});

test("repeated clicks send one installation request", async t => {
  let complete!: (response: Response) => void;
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (_input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes++;
      return new Promise<Response>(resolve => { complete = resolve; });
    }
    return Response.json({ active: "", installed: [] });
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  await act(async () => {
    const button = view.getByRole("button", { name: "安装并启用" });
    fireEvent.click(button);
    fireEvent.click(button);
  });
  assert.equal(writes, 1);
  await act(async () => { complete(Response.json({ error: "下载失败" }, { status: 502 })); });
  assert.equal(view.getByRole("button", { name: "安装并启用" }).hasAttribute("disabled"), false);
});

const current = { name: "community-web", version: "1.2.0", repository: "Community/Web" };
const currentStatus = { active: "community-web@1.2.0", current, installed: [] };

test("an active repository checks for updates and installs only after a second click", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${input}`);
    if (input.endsWith("/update")) return Response.json({ repository: props.repository, current, latestVersion: "1.10.0", updateAvailable: true });
    if (input.endsWith("/install")) return Response.json({ error: "下载失败" }, { status: 502 });
    return Response.json(currentStatus);
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  assert.ok(view.getByText("community-web 1.2.0"));
  assert.ok(view.getByRole("button", { name: "检查更新" }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "检查更新" })); });
  assert.deepEqual(calls, ["GET /admin/api/frontend", "GET /admin/api/frontend/update"]);
  assert.match(view.getByRole("status").textContent || "", /发现新版本 1.10.0/);
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "更新并启用" })); });
  assert.equal(calls.at(-1), "POST /admin/api/frontend/install");
  assert.match(view.getByRole("alert").textContent || "", /下载失败/);
  assert.ok(view.getByRole("button", { name: "检查更新" }));
  assert.ok(view.getByText("community-web 1.2.0"));
});

test("no update shows current feedback and keeps checking available after revisiting", async t => {
  let checks = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.endsWith("/update")) { checks++; return Response.json({ repository: props.repository, current, latestVersion: "1.2.0", updateAvailable: false }); }
    return Response.json(currentStatus);
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, { ...props, repository: "https://github.com/community/web.git/" })); });
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "检查更新" })); });
  assert.equal(view.getByRole("status").textContent, "已是最新版本");
  assert.ok(view.getByRole("button", { name: "检查更新" }));
  assert.equal(view.queryByRole("button", { name: "安装并启用" }), null);
  view.unmount();
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  assert.ok(view.getByRole("button", { name: "检查更新" }));
  assert.equal(view.queryByRole("status"), null);
  assert.equal(checks, 1);
});

test("failed checks never report latest and can be retried", async t => {
  t.mock.method(globalThis, "fetch", async (input: string) => input.endsWith("/update")
    ? Response.json({ error: "GitHub 暂时不可用" }, { status: 502 }) : Response.json(currentStatus));
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "检查更新" })); });
  assert.match(view.getByRole("alert").textContent || "", /GitHub 暂时不可用/);
  assert.equal(view.queryByRole("status"), null);
  assert.equal(view.getByRole("button", { name: "检查更新" }).hasAttribute("disabled"), false);
});

test("changing repositories discards a pending check and later uses install", async t => {
  let complete!: (response: Response) => void;
  let checks = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.endsWith("/update")) { checks++; return new Promise<Response>(resolve => { complete = resolve; }); }
    return Response.json(currentStatus);
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  await act(async () => {
    const button = view.getByRole("button", { name: "检查更新" });
    fireEvent.click(button); fireEvent.click(button);
  });
  assert.equal(checks, 1);
  assert.equal(view.getByRole("button", { name: "检查中…" }).hasAttribute("disabled"), true);
  view.rerender(createElement(FrontendSettingsSection, { ...props, repository: "https://github.com/other/web" }));
  await act(async () => { complete(Response.json({ repository: props.repository, current, latestVersion: "1.3.0", updateAvailable: true })); });
  assert.equal(view.queryByRole("status"), null);
  assert.ok(view.getByRole("button", { name: "安装并启用" }));
  view.rerender(createElement(FrontendSettingsSection, props));
  assert.ok(view.getByRole("button", { name: "检查更新" }));
});

test("status must be loaded before installation can be offered", async t => {
  let complete!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", async () => new Promise<Response>(resolve => { complete = resolve; }));
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(FrontendSettingsSection, props)); });
  assert.equal(view.getByRole("button", { name: "加载中…" }).hasAttribute("disabled"), true);
  await act(async () => { complete(Response.json(currentStatus)); });
  assert.ok(view.getByRole("button", { name: "检查更新" }));
});

test("installed frontends can be picked and enabled without downloading", async t => {
  const calls: string[] = [];
  const bundled = { formatVersion: 1, apiMin: "1.0.0", apiMaxExclusive: "2.0.0", sha256: "a", contentHash: "b", installedAt: "" };
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${input}`);
    if (input.endsWith("/install")) return Response.json({ error: "启用失败" }, { status: 400 });
    return Response.json({
      active: "",
      current: { name: "91-web", version: "1.0.0", repository: "https://github.com/nianzhibai/91-web" },
      installed: [
        { ...bundled, name: "91-web", version: "1.0.0", repository: "https://github.com/nianzhibai/91-web" },
        { ...bundled, name: "91-web-nostalgic", version: "1.0.0", repository: "nianzhibai/91-web-nostalgic" },
        { ...bundled, name: "custom", version: "0.1.0" },
      ],
    });
  });
  const changes: string[] = [];
  const nostalgic = "https://github.com/nianzhibai/91-web-nostalgic";
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(createElement(FrontendSettingsSection, { ...props, repository: "https://github.com/nianzhibai/91-web", onRepositoryChange: (value: string) => changes.push(value) }));
  });
  const choices = view.getByRole("group", { name: "本地可用的前端" });
  assert.deepEqual([...choices.querySelectorAll("button")].map(button => [button.textContent, button.getAttribute("aria-pressed")]),
    [["91-web", "true"], ["91-web-nostalgic", "false"]]);
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "91-web-nostalgic" })); });
  assert.deepEqual(changes, [nostalgic]);
  view.rerender(createElement(FrontendSettingsSection, { ...props, repository: nostalgic }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "启用" })); });
  assert.equal(calls.at(-1), "POST /admin/api/frontend/install");
  assert.match(view.getByRole("alert").textContent || "", /启用失败/);
});
