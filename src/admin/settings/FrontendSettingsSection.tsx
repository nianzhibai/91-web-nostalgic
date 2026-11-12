import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Monitor, Upload } from "lucide-react";
import type { Frontend } from "@91/client";
import { client } from "@/client";
import { useAdminRouteActive } from "../AdminRouteCache";
import { ConfirmModal } from "../ConfirmModal";
import { useAdminResource } from "../useAdminResource";
import { SettingsRow, SettingsSection } from "./SettingsSection";

type Action =
  | { kind: "activate"; frontend: Frontend }
  | { kind: "update"; frontend: Frontend; version: string }
  | { kind: "install"; repository: string }
  | { kind: "upload"; file: File };

const loadFrontends = () => client.frontend.list().then(result => result.frontends);

export function isValidFrontendRepository(value: string) {
  return /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*\/?$/.test(value);
}

function repositoryPath(repository: string) {
  return repository.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/, "");
}

function frontendLabel(frontend: Frontend) {
  return frontend.name || "默认前端";
}

function frontendDetail(frontend: Frontend) {
  const source = frontend.builtin ? "内置"
    : frontend.repository ? `github.com/${repositoryPath(frontend.repository)}`
    : "本地上传";
  return frontend.version ? `v${frontend.version} · ${source}` : source;
}

// Builtin frontends ship with the application; anything else is confirmed
// because it replaces the management UI that is used to switch back.
function confirmation(action: Action) {
  switch (action.kind) {
    case "activate":
      return action.frontend.builtin ? null : { title: "切换前端", message: `切换到 ${frontendLabel(action.frontend)}？`, confirmText: "切换" };
    case "install":
      return { title: "安装前端", message: `安装并切换到 ${repositoryPath(action.repository)}？`, confirmText: "安装并切换" };
    case "upload":
      return { title: "上传前端", message: `安装并切换到 ${action.file.name}？`, confirmText: "安装并切换" };
    case "update":
      return null;
  }
}

export function FrontendSettingsSection() {
  const routeActive = useAdminRouteActive();
  const resource = useAdminResource<Frontend[] | null>(loadFrontends, {
    active: routeActive,
    intervalMs: null,
    initialData: null,
  });
  const frontends = resource.data;
  const [updates, setUpdates] = useState<ReadonlyMap<string, string>>(new Map());
  const [repository, setRepository] = useState("");
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = pending !== null;
  const repositoryValid = isValidFrontendRepository(repository.trim());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Metadata only; a failed check simply offers no update.
  useEffect(() => {
    let cancelled = false;
    client.frontend.updates().then(
      result => { if (!cancelled) setUpdates(new Map(result.updates.map(update => [update.name, update.version]))); },
      () => {}
    );
    return () => { cancelled = true; };
  }, []);

  function request(action: Action) {
    if (busy) return;
    setError("");
    if (confirmation(action)) setConfirming(action);
    else void run(action);
  }

  async function run(action: Action) {
    if (running.current) return;
    running.current = true;
    setPending(action);
    setError("");
    try {
      const result = action.kind === "activate" ? await client.frontend.activate(action.frontend.id)
        : action.kind === "upload" ? await client.frontend.upload(action.file)
        : await client.frontend.install(action.kind === "install" ? action.repository : action.frontend.repository!);
      if (!mounted.current) return;
      resource.setData(result.frontends);
      // The page stays busy until the browser loads the selected frontend.
      if (action.kind === "update") window.location.reload();
      else window.location.assign("/");
    } catch (failure) {
      running.current = false;
      if (!mounted.current) return;
      setPending(null);
      setConfirming(null);
      setError(failure instanceof Error ? failure.message : "操作失败，请重试");
    }
  }

  function addRepository() {
    const value = repository.trim();
    if (!isValidFrontendRepository(value)) return;
    const key = repositoryPath(value).toLowerCase();
    const existing = frontends?.find(frontend => frontend.repository && repositoryPath(frontend.repository).toLowerCase() === key);
    if (existing?.active) {
      setError(`${frontendLabel(existing)} 正在使用`);
      return;
    }
    request(existing ? { kind: "activate", frontend: existing } : { kind: "install", repository: value });
  }

  function spinner(active: boolean): ReactNode {
    return active ? <Loader2 size={14} className="admin-spin" aria-hidden="true" /> : null;
  }

  const prompt = confirming ? confirmation(confirming) : null;

  return (
    <SettingsSection
      id="config-frontend"
      index="04"
      icon={<Monitor size={16} />}
      title="前端配置"
      description="选择站点使用的前端，切换后立即生效"
    >
      {frontends === null ? (
        <div className="admin-config-row frontend-settings__placeholder">
          <span className="frontend-settings__detail">{resource.error ? resource.error : "正在读取前端…"}</span>
          {resource.error && (
            <button type="button" className="admin-btn" onClick={() => void resource.invalidate()}>重新读取</button>
          )}
        </div>
      ) : (
        <ul className="frontend-settings__list" aria-label="可用的前端">
          {frontends.length === 0 && (
            <li className="admin-config-row frontend-settings__placeholder">
              <span className="frontend-settings__detail">暂无可用的前端，可在下方添加</span>
            </li>
          )}
          {frontends.map(frontend => {
            const label = frontendLabel(frontend);
            const update = frontend.active && frontend.repository ? updates.get(frontend.name) : undefined;
            const activating = pending?.kind === "activate" && pending.frontend.name === frontend.name;
            const updating = pending?.kind === "update" && pending.frontend.name === frontend.name;
            return (
              <li key={frontend.name || "default"} className="admin-config-row frontend-settings__item">
                <div className="admin-config-row__copy">
                  <span>{label}</span>
                  <p>{frontendDetail(frontend)}</p>
                </div>
                <div className="frontend-settings__actions">
                  {update && (
                    <button
                      type="button"
                      className="admin-btn"
                      disabled={busy}
                      onClick={() => request({ kind: "update", frontend, version: update })}
                    >
                      {spinner(updating)}
                      {updating ? "更新中…" : `更新到 v${update}`}
                    </button>
                  )}
                  {frontend.active ? (
                    <span className="frontend-settings__badge"><Check size={13} aria-hidden="true" />使用中</span>
                  ) : (
                    <button
                      type="button"
                      className="admin-btn"
                      aria-label={`使用 ${label}`}
                      disabled={busy}
                      onClick={() => request({ kind: "activate", frontend })}
                    >
                      {spinner(activating)}
                      {activating ? "切换中…" : "使用"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <SettingsRow
        label="添加前端"
        htmlFor="frontend-repository"
        description="安装 GitHub 仓库的最新发布，或上传自己构建的 frontend.tar.gz，完成后自动切换"
      >
        <div className="admin-config-control frontend-settings__add">
          <input
            id="frontend-repository"
            className="admin-input"
            type="url"
            value={repository}
            placeholder="https://github.com/owner/name"
            onChange={event => setRepository(event.target.value)}
            // This section lives inside the configuration form; Enter must not save it.
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addRepository(); } }}
            disabled={busy}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-invalid={repository !== "" && !repositoryValid}
          />
          <button type="button" className="admin-btn is-primary" disabled={busy || !repositoryValid} onClick={addRepository}>
            {spinner(pending?.kind === "install")}
            安装
          </button>
          <button type="button" className="admin-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            {pending?.kind === "upload" ? spinner(true) : <Upload size={14} aria-hidden="true" />}
            上传
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".tar.gz,.tgz,application/gzip"
            hidden
            aria-label="上传前端安装包"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) request({ kind: "upload", file });
            }}
          />
        </div>
      </SettingsRow>
      {error && <p className="frontend-settings__message is-error" role="alert">{error}</p>}
      <ConfirmModal
        open={prompt !== null}
        title={prompt?.title ?? ""}
        message={prompt?.message ?? ""}
        hideIcon
        confirmText={prompt?.confirmText}
        loading={busy}
        onCancel={() => { if (!busy) setConfirming(null); }}
        onConfirm={() => { if (confirming) void run(confirming); }}
      />
    </SettingsSection>
  );
}
