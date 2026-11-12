import { useEffect, useRef, useState } from "react";
import { QrCode } from "lucide-react";
import * as api from "../api";
import { useToast } from "@/components/ToastContext";

const DRIVE_LOGIN_KINDS: ReadonlySet<string> = new Set<api.DriveLoginKind>([
  "guangyapan", "p115", "p123", "quark", "wopan", "yun139",
]);

/** Drive kinds whose credentials can be filled by scanning a QR code. */
export function supportsDriveQRLogin(kind: string): kind is api.DriveLoginKind {
  return DRIVE_LOGIN_KINDS.has(kind);
}

type Progress = { state: api.DriveLoginState; message?: string };

function progressText(progress: Progress | null): string {
  switch (progress?.state) {
    case "scanned": return progress.message || "已扫码，请在手机上确认登录";
    case "success": return "登录成功，保存后生效";
    case "expired": return "二维码已过期，请重新生成。";
    case "rejected": return "登录已被拒绝或取消，请重新生成二维码。";
    case "failed": return progress.message || "扫码登录失败，请重新生成二维码。";
    default: return "";
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function expiryTime(expiresAt: string) {
  return new Date(expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Runs one server-side drive login: a single request in flight at a time,
 * polling that survives parent rerenders, and cancellation on regenerate or
 * unmount. Callbacks are read through a ref so late responses reach the
 * latest form state.
 */
export function DriveQRLogin({
  kind,
  label,
  onCredentials,
}: {
  kind: api.DriveLoginKind;
  /** Drive name used in the QR image's alternative text. */
  label: string;
  /** Receives credentials keyed by the drive's credential fields. */
  onCredentials: (credentials: Record<string, string>) => void;
}) {
  const { show } = useToast();
  const [session, setSession] = useState<api.DriveLoginSession | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollingError, setPollingError] = useState("");
  const latestRef = useRef({ onCredentials, show });
  latestRef.current = { onCredentials, show };
  const startControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => startControllerRef.current?.abort(), []);

  async function start() {
    startControllerRef.current?.abort();
    const controller = new AbortController();
    startControllerRef.current = controller;
    setStarting(true);
    setSession(null);
    setProgress(null);
    setPollingError("");
    try {
      const next = await api.startDriveLogin(kind, controller.signal);
      if (!controller.signal.aborted) setSession(next);
    } catch (error) {
      if (!controller.signal.aborted) latestRef.current.show(errorMessage(error, "生成二维码失败"), "error");
    } finally {
      if (!controller.signal.aborted) setStarting(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    const active = session;
    const controller = new AbortController();
    let interval = active.intervalMs;
    let timer: number | undefined;
    let finished = false;

    function finish(next: Progress) {
      finished = true;
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(expiryTimer);
      setPollingError("");
      setProgress(next);
    }

    // A stalled poll must not outlive the QR code it is waiting on.
    const expiryTimer = window.setTimeout(
      () => finish({ state: "expired" }),
      Math.max(0, Date.parse(active.expiresAt) - Date.now())
    );

    async function poll() {
      try {
        const result = await api.pollDriveLogin(active.id, controller.signal);
        if (controller.signal.aborted) return;
        interval = result.intervalMs;
        if (result.state === "success") {
          finish({ state: "success" });
          const { onCredentials, show } = latestRef.current;
          onCredentials(result.credentials ?? {});
          show("扫码成功，已填入登录凭据，保存后生效", "success");
          return;
        }
        if (result.state !== "waiting" && result.state !== "scanned") {
          finish(result);
          return;
        }
        setProgress(result);
        setPollingError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        // The server forgets a login after it ends, expires or restarts.
        if (error instanceof api.APIResponseError && error.status === 404) {
          finish({ state: "expired" });
          return;
        }
        setPollingError(errorMessage(error, "查询扫码状态失败"));
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, interval);
    }

    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(expiryTimer);
      if (!finished) void api.cancelDriveLogin(active.id).catch(() => {});
    };
  }, [session]);

  const status = progressText(progress);
  const ended = !!progress && progress.state !== "waiting" && progress.state !== "scanned";
  return (
    <div className="admin-form__row admin-drive-qr-login">
      <span className="admin-form__label">扫码登录</span>
      <div className="admin-p123-qr">
        <div className="admin-p123-qr__actions">
          <button type="button" className="admin-btn" onClick={start} disabled={starting}>
            <QrCode size={14} />
            {starting ? "生成中..." : session ? "重新生成二维码" : "生成二维码"}
          </button>
        </div>

        {session && (
          <div className="admin-p123-qr__body">
            <img className="admin-p123-qr__image" src={session.qrImageDataUrl} alt={`${label}扫码登录二维码`} />
            <div className="admin-p123-qr__meta" aria-live="polite">
              {pollingError && <div className="admin-form__help">{pollingError}</div>}
              {status && <div className="admin-form__help">{status}</div>}
              {!ended && <div className="admin-form__help">过期时间：{expiryTime(session.expiresAt)}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
