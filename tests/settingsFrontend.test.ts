import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { act, fireEvent, render, within } from "./helpers/dom";
import { ToastProvider } from "../src/components/ToastContext";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  return nextLoad(url, context);
} });
Object.defineProperty(globalThis, "Window", { configurable: true, value: window.Window });
window.scrollTo = () => {};
window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
window.Range.prototype.getBoundingClientRect = () => new window.DOMRect();
const { SettingsPage } = await import("../src/admin/SettingsPage");

async function openSettings(path: string) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(ToastProvider, null, createElement(SettingsPage))));
  });
  return view;
}

test("frontend switching is independent of unsaved configuration changes", async t => {
  const writes: { path: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    if (input.endsWith("config.yaml")) return new Response('nightly:\n  start_time: "01:00"\n', { headers: { ETag: '"v1"' } });
    if (init?.method === "POST") writes.push({ path: input, body: init.body });
    if (input.endsWith("/updates")) return Response.json({ updates: [] });
    return Response.json({ frontends: [
      { id: "", name: "web", version: "1.0.0", builtin: true, active: true },
      { id: "other@1.0.0", name: "other", version: "1.0.0", builtin: true, active: false },
    ] });
  });
  const view = await openSettings("/admin/settings");
  fireEvent.change(view.getByLabelText("启动时间"), { target: { value: "02:30" } });
  await act(async () => { fireEvent.click(view.getByRole("tab", { name: "前端配置" })); });
  assert.ok(view.getByRole("tab", { name: "前端配置", selected: true }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "使用 other" })); });
  assert.deepEqual(writes, [{ path: "/admin/api/frontend/activate", body: '{"id":"other@1.0.0"}' }]);
  assert.equal(view.container.querySelector("form form"), null);
});

test("visiting frontend configuration preserves other unsaved YAML fields", async t => {
  t.mock.method(globalThis, "fetch", async (input: string) => input.endsWith("config.yaml")
    ? new Response('nightly:\n  start_time: "01:00"\n', { headers: { ETag: '"v1"' } })
    : Response.json(input.endsWith("/updates") ? { updates: [] } : { frontends: [] }));
  const view = await openSettings("/admin/settings");
  fireEvent.change(view.getByLabelText("启动时间"), { target: { value: "02:30" } });
  await act(async () => { fireEvent.click(view.getByRole("tab", { name: "前端配置" })); });
  assert.ok(view.getByLabelText("添加前端"));
  await act(async () => { fireEvent.click(view.getByRole("tab", { name: "定时任务" })); });
  assert.equal((view.getByLabelText("启动时间") as HTMLInputElement).value, "02:30");
  assert.equal(view.getByRole("button", { name: "预览并保存配置" }).hasAttribute("disabled"), false);
});
