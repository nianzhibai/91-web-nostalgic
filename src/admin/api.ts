import { UnauthorizedError } from "@91/client/http";
import { client } from "../client";
import { applyPreviewEnabled } from "../lib/previewSettings";
import { applyTelegramEnabled } from "./telegram/availability";
export * from "@91/client/admin";
export { APIResponseError, UnauthorizedError } from "@91/client/http";
export type { Theme } from "@91/client/types";

const sessionExpiredListeners = new Set<() => void>();

/** Notifies when any admin request reports an expired session. */
export function onSessionExpired(listener: () => void) {
  sessionExpiredListeners.add(listener);
  return () => { sessionExpiredListeners.delete(listener); };
}

function reportSessionExpiry(error: unknown): never {
  if (error instanceof UnauthorizedError) {
    // The SDK message is a protocol token; callers surface this one directly.
    error.message = "登录已过期，请重新登录";
    for (const listener of sessionExpiredListeners) listener();
  }
  throw error;
}

// Every admin request funnels a 401 into one session expiry, so pages and
// hooks never need their own redirect plumbing.
function guardSession<T extends object>(methods: T): T {
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [
    name,
    typeof method === "function"
      ? (...args: unknown[]) => {
        const result = method(...args);
        return result instanceof Promise ? result.catch(reportSessionExpiry) : result;
      }
      : method,
  ])) as T;
}

const admin = guardSession(client.admin);

export const { login, logout, me, setupStatus, setupAdmin } = client.auth;
export const {
  checkUpdate,
  logQueryParams,
  listLogs,
  downloadLogs,
  clearLogs,
  listBackups,
  createBackup,
  cancelBackup,
  deleteBackup,
  backupDownloadURL,
  beginBackupUpload,
  getBackupUpload,
  putBackupUploadChunk,
  finalizeBackupUpload,
  cancelBackupUpload,
  restoreBackup,
  listBackupTransfers,
  listBackupReceiveTransfers,
  cancelBackupReceiveTransfer,
  createBackupTransfer,
  cancelBackupTransfer,
  retryBackupTransfer,
  createBackupReceiveToken,
  listDrives,
  getDriveCredentials,
  getDriveStorage,
  getDriveSnapshot,
  subscribeDriveSnapshots,
  upsertDrive,
  deleteDrive,
  rescan,
  stopDriveTasks,
  listCrawlers,
  upsertCrawler,
  importCrawlerScriptFile,
  importCrawlerScriptURL,
  testCrawlerScript,
  runCrawler,
  uploadCrawlerVideos,
  stopCrawlerTasks,
  setCrawlerPaused,
  deleteCrawler,
  startDriveLogin,
  pollDriveLogin,
  cancelDriveLogin,
  listDriveDirChildren,
  setDriveSkipDirIds,
  generateDrivePreviews,
  generateDriveThumbnails,
  generateDriveFingerprints,
  listVideos,
  getVideoStats,
  listBlacklist,
  removeBlacklist,
  getBlacklistSourceDeleteStatus,
  startBlacklistSourceDelete,
  updateVideo,
  deleteVideo,
  regenPreview,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  getSettings,
  updateSettings,
  getGPUStatus,
  probeGPU,
  getConfigYAML,
  getScanAllJobStatus,
  runScanAllJob,
  stopAllTasks,
  listUsers,
  createUser,
  deleteUser,
  banUser,
  unbanUser,
  resetPassword,
  listBannedIPs,
  unbanIP,
  getTelegramAvailability,
  getTelegramStatus,
  testTelegram,
  resumeTelegram,
  listTelegramImports,
  cancelImport,
  retryImport
} = admin;

export async function updateConfigYAML(content: string, version: string) {
  const result = await admin.updateConfigYAML(content, version);
  applyPreviewEnabled(result.settings.previewEnabled);
  applyTelegramEnabled(result.settings.telegramEnabled);
  return result;
}
