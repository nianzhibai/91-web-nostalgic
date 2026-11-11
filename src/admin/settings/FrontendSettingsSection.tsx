import { useEffect, useRef, useState } from "react";
import { Loader2, Monitor } from "lucide-react";
import type { FrontendStatus, FrontendUpdateCheck } from "@91/client";
import { client } from "@/client";
import { useAdminRouteActive } from "../AdminRouteCache";
import { useAdminResource } from "../useAdminResource";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { isValidFrontendRepository } from "./configYaml";

type Props = {
  repository: string;
  configurationSaved: boolean;
  disabled: boolean;
  onRepositoryChange: (value: string) => void;
};

const loadStatus = () => client.frontend.status();

function repositoryKey(repository: string) {
  return repository.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/, "").toLowerCase();
}

type LocalFrontend = { key: string; name: string; url: string };

// Installed releases, including bundled ones, can be enabled without downloading.
function localFrontends(status: FrontendStatus | null): LocalFrontend[] {
  const frontends = new Map<string, LocalFrontend>();
  for (const release of status?.installed ?? []) {
    if (!release.repository) continue;
    const key = repositoryKey(release.repository);
    const path = release.repository.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/, "");
    if (!frontends.has(key)) frontends.set(key, { key, name: path.split("/").pop() || path, url: `https://github.com/${path}` });
  }
  return [...frontends.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function FrontendSettingsSection({ repository, configurationSaved, disabled, onRepositoryChange }: Props) {
  const resource = useAdminResource<FrontendStatus | null>(loadStatus, {
    active: useAdminRouteActive(),
    intervalMs: null,
    initialData: null,
  });
  const status = resource.data;
  const [pending, setPending] = useState<"check" | "enable" | "install" | "update" | null>(null);
  const [checked, setChecked] = useState<FrontendUpdateCheck | null>(null);
  const [error, setError] = useState("");
  const operationRunning = useRef(false);
  const mounted = useRef(true);
  const valid = isValidFrontendRepository(repository);
  const busy = pending !== null;
  const current = status?.current;
  const usingRepository = Boolean(current?.repository && repositoryKey(current.repository) === repositoryKey(repository));
  const available = localFrontends(status);
  const installedLocally = available.some(frontend => frontend.key === repositoryKey(repository));
  const contextKey = JSON.stringify([repository, configurationSaved, current?.name, current?.version, current?.repository]);
  const requestGeneration = useRef(0);
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;

  useEffect(() => {
    requestGeneration.current++;
    setChecked(null);
    setError("");
  }, [contextKey]);

  const updateAvailable = usingRepository && checked?.updateAvailable === true;
  const buttonText = pending === "check" ? "检查中…"
    : pending === "update" ? "更新并启用中…"
    : pending === "install" ? "安装并启用中…"
    : pending === "enable" ? "启用中…"
    : !status ? resource.error ? "重新读取" : "加载中…"
    : !usingRepository ? installedLocally ? "启用" : "安装并启用"
    : updateAvailable ? "更新并启用" : "检查更新";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function actOnFrontend() {
    if (operationRunning.current || disabled || !configurationSaved || !valid) return;
    if (!status) {
      await resource.invalidate();
      return;
    }
    operationRunning.current = true;
    const operation = usingRepository && !updateAvailable ? "check" : usingRepository ? "update" : installedLocally ? "enable" : "install";
    const generation = requestGeneration.current;
    const requestContext = contextKey;
    const stillCurrent = () => mounted.current && generation === requestGeneration.current && contextRef.current === requestContext;
    setPending(operation);
    setError("");
    setChecked(null);
    try {
      if (operation === "check") {
        const result = await client.frontend.checkUpdate();
        if (!stillCurrent()) return;
        if (repositoryKey(result.repository) !== repositoryKey(repository) ||
            repositoryKey(result.current.repository) !== repositoryKey(current?.repository || "") ||
            result.current.name !== current?.name || result.current.version !== current?.version) {
          await resource.invalidate();
          throw new Error("仓库配置或当前前端已变化，请重新加载配置后检查");
        }
        setChecked(result);
      } else {
        const release = await client.frontend.install();
        if (!mounted.current) return;
        resource.setData({
          ...status,
          active: `${release.name}@${release.version}`,
          current: { name: release.name, version: release.version, repository: release.repository || repository },
          installed: [...status.installed.filter(item => item.name !== release.name || item.version !== release.version), release],
        });
        if (stillCurrent()) window.location.assign("/");
      }
    } catch (failure) {
      if (stillCurrent()) setError(failure instanceof Error ? failure.message : operation === "check" ? "检查更新失败，请重试" : operation === "enable" ? "启用失败，请重试" : "安装失败，请重试");
    } finally {
      operationRunning.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return (
    <SettingsSection
      id="config-frontend"
      index="04"
      icon={<Monitor size={16} />}
      title="前端配置"
      description="自定义配置前端"
    >
      <SettingsRow label="前端仓库" htmlFor="frontend-repository" description="填写完整的 GitHub 仓库链接，或选择本地可用的前端">
        <div className="admin-config-control frontend-settings__repository">
          <input
            id="frontend-repository"
            className="admin-input"
            type="url"
            value={repository}
            placeholder="https://github.com/owner/name"
            onChange={event => onRepositoryChange(event.target.value)}
            disabled={disabled || busy}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-invalid={!valid}
            aria-describedby={!valid ? "frontend-repository-hint" : !configurationSaved ? "frontend-save-hint" : undefined}
          />
          {available.length > 1 && (
            <div className="frontend-settings__choices" role="group" aria-label="本地可用的前端">
              {available.map(frontend => {
                const selected = frontend.key === repositoryKey(repository);
                return (
                  <button
                    key={frontend.key}
                    type="button"
                    className={`frontend-settings__choice${selected ? " is-active" : ""}`}
                    aria-pressed={selected}
                    title={frontend.url}
                    disabled={disabled || busy}
                    onClick={() => onRepositoryChange(frontend.url)}
                  >
                    {frontend.name}
                  </button>
                );
              })}
            </div>
          )}
          {!valid && <span id="frontend-repository-hint" className="frontend-settings__message is-error">请输入完整链接，例如 https://github.com/owner/name</span>}
          {valid && !configurationSaved && <span id="frontend-save-hint" className="frontend-settings__message">请先保存配置，再操作前端。</span>}
        </div>
      </SettingsRow>
      <SettingsRow label="当前前端">
        <div className="frontend-settings__current">
          <span className="frontend-settings__identity">
            {current ? `${current.name} ${current.version}` : status ? status.active || (status.builtin ? `${status.builtin.name} ${status.builtin.version}` : "默认前端") : resource.loading ? "加载中…" : "暂时无法读取"}
          </span>
          <button type="button" className="admin-btn is-primary" disabled={disabled || busy || !configurationSaved || !valid || (!status && !resource.error)} onClick={() => void actOnFrontend()}>
            {(busy || (!status && resource.loading)) && <Loader2 size={14} className="admin-spin" aria-hidden="true" />}
            {buttonText}
          </button>
        </div>
      </SettingsRow>
      {usingRepository && checked && <p className="frontend-settings__message" role="status">
        {checked.updateAvailable ? `发现新版本 ${checked.latestVersion}` : "已是最新版本"}
      </p>}
      {(error || resource.error) && <p className="frontend-settings__message is-error" role="alert">{error || resource.error}</p>}
    </SettingsSection>
  );
}
