import { APIResponseError, UnauthorizedError, type UploadVideoInput } from "@91/client";
import { client } from "../client";
import type { VideoItem } from "../types";

export type UploadProgress = { loaded: number; total: number };

/**
 * Local uploads can take minutes, so they bypass the SDK's `fetch`-based
 * `uploadVideo` (which exposes neither upload progress nor cancellation) and
 * send the same multipart form through XHR.
 */
export function uploadVideoWithProgress(
  input: UploadVideoInput,
  options: { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void } = {}
): Promise<VideoItem> {
  const body = new FormData();
  body.append("file", input.file);
  if (input.title.trim()) body.append("title", input.title.trim());
  for (const tag of input.tags) body.append("tags", tag);

  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = () => signal?.removeEventListener("abort", abort);

    xhr.open("POST", client.admin.uploadURL());
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.({ loaded: event.loaded, total: event.total });
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as VideoItem);
        } catch {
          reject(new Error("上传成功，但服务端返回了无法识别的结果"));
        }
        return;
      }
      reject(uploadResponseError(xhr));
    };
    xhr.onerror = () => {
      settle();
      reject(new Error("网络连接中断，上传失败"));
    };
    xhr.onabort = () => {
      settle();
      reject(signal?.reason ?? new DOMException("Upload aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

function uploadResponseError(xhr: XMLHttpRequest): APIResponseError {
  let body: unknown;
  let message = "";
  try {
    body = JSON.parse(xhr.responseText);
    if (body && typeof body === "object") {
      const parsed = body as { error?: unknown; message?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
      else if (typeof parsed.message === "string") message = parsed.message;
    }
  } catch {
    // A proxy may answer with plain text (usable) or an HTML error page (not).
    const text = xhr.responseText.trim();
    if (text && !/<!doctype\s+html\b|<html\b|<head\b|<body\b/i.test(text)) message = text;
  }
  if (xhr.status === 401) return new UnauthorizedError(body);
  if (!message) {
    message = xhr.status === 413
      ? "文件超过服务器允许的大小"
      : xhr.status >= 500
        ? `网站服务暂时不可用（HTTP ${xhr.status}），请稍后重试`
        : `上传失败（HTTP ${xhr.status}）`;
  }
  return new APIResponseError(xhr.status, message, body);
}
