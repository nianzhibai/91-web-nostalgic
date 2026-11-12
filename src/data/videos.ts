import { client } from "../client";
import type { VideoDetail, VideoItem } from "../types";
import type { TagItem } from "@91/client/types";
import { filterDeletedVideos, isVideoDeleted, markVideoDeleted, subscribeVideoDeletions } from "../lib/videoDeletions";
export * from "@91/client/videos";
export type { TagItem } from "@91/client/types";
export type { CreateRemoteUploadInput, RemoteUploadJob, RemoteUploadState, UploadVideoInput } from "@91/client/admin";

export const {
  listHome: fetchHomeVideos,
  listLatest: fetchLatestHomeVideos,
  list: fetchListing,
  getFeed: fetchVideoFeed,
  getCollection: fetchVideoCollection,
  getCollectionSummary: fetchVideoCollectionSummary,
  listSubtitles: fetchVideoSubtitles,
  createShare: createVideoShare,
  claimShare: consumeVideoShare,
  listSharedSubtitles: fetchSharedVideoSubtitles,
  recordSharedView: recordSharedVideoView,
  recordView,
  setLike: setVideoLike,
  setReaction: setVideoVisitReaction,
  getShorts: fetchShortsNext
} = client.videos;

// Library management used by the upload, detail and shorts pages.
export const {
  updateVideoTags,
  hideVideo,
  uploadVideo,
  createRemoteUpload,
  cancelRemoteUpload,
  listRemoteUploads: fetchRemoteUploads,
  listUploadTags: fetchUploadTags,
} = client.admin;

export function fetchVideoDetail(id: string): Promise<VideoDetail | null> {
  if (isVideoDeleted(id)) return Promise.resolve(null);
  return client.videos.get(id).then(detail => isVideoDeleted(id) ? null : detail);
}

export async function fetchVideoRecommendations(id: string, options: { signal?: AbortSignal } = {}): Promise<VideoItem[]> {
  return filterDeletedVideos(await client.videos.listRecommendations(id, options));
}

export async function deleteVideo(id: string, options: { deleteSource?: boolean } = {}) {
  const result = await client.admin.deleteVideo(id, options);
  markVideoDeleted(id);
  return result;
}

const VIDEO_DETAIL_PREFETCH_TTL_MS = 30_000;
const VIDEO_DETAIL_PREFETCH_LIMIT = 20;

type PrefetchedVideoDetail = {
  expiresAt: number;
  request: Promise<VideoDetail | null>;
};

const prefetchedVideoDetailsByID = new Map<string, PrefetchedVideoDetail>();

/**
 * Start the small detail JSON request from the card's pointer-down event. The
 * route module can load at the same time and consume this request after mount.
 */
export function prefetchVideoDetail(id: string): Promise<VideoDetail | null> {
  const now = Date.now();
  pruneVideoDetailPrefetches(now);
  const existing = prefetchedVideoDetailsByID.get(id);
  if (existing && existing.expiresAt > now) return existing.request;

  const request = fetchVideoDetail(id);
  const entry = {
    expiresAt: now + VIDEO_DETAIL_PREFETCH_TTL_MS,
    request,
  };
  prefetchedVideoDetailsByID.set(id, entry);
  trimVideoDetailPrefetches();

  void request.then(
    (detail) => {
      if (
        detail === null &&
        prefetchedVideoDetailsByID.get(id)?.request === request
      ) {
        prefetchedVideoDetailsByID.delete(id);
      }
    },
    () => {
      if (prefetchedVideoDetailsByID.get(id)?.request === request) {
        prefetchedVideoDetailsByID.delete(id);
      }
    }
  );
  return request;
}

/**
 * A prefetched response is navigation-scoped rather than a second long-lived
 * detail cache. Consume it once so later background validation still reaches
 * the server and can observe edits.
 */
export function consumePrefetchedVideoDetail(
  id: string
): Promise<VideoDetail | null> | null {
  if (isVideoDeleted(id)) return Promise.resolve(null);
  const entry = prefetchedVideoDetailsByID.get(id);
  prefetchedVideoDetailsByID.delete(id);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.request;
}

function pruneVideoDetailPrefetches(now: number) {
  for (const [id, entry] of prefetchedVideoDetailsByID) {
    if (entry.expiresAt <= now) prefetchedVideoDetailsByID.delete(id);
  }
}

function trimVideoDetailPrefetches() {
  while (prefetchedVideoDetailsByID.size > VIDEO_DETAIL_PREFETCH_LIMIT) {
    const oldestID = prefetchedVideoDetailsByID.keys().next().value;
    if (!oldestID) return;
    prefetchedVideoDetailsByID.delete(oldestID);
  }
}


const VIDEO_RECOMMENDATIONS_PREFETCH_TTL_MS = 30_000;
const VIDEO_RECOMMENDATIONS_PREFETCH_LIMIT = 20;

type PrefetchedVideoRecommendations = {
  expiresAt: number;
  request: Promise<VideoItem[]>;
};

const prefetchedVideoRecommendationsByID = new Map<
  string,
  PrefetchedVideoRecommendations
>();

subscribeVideoDeletions((id) => {
  prefetchedVideoDetailsByID.delete(id);
  // Recommendation prefetches may contain this ID under any source video.
  prefetchedVideoRecommendationsByID.clear();
});

/**
 * Start recommendations only after a click is confirmed as navigation. Their
 * request runs beside the core detail request but never joins its loading state.
 */
export function prefetchVideoRecommendations(
  id: string
): Promise<VideoItem[]> {
  const now = Date.now();
  pruneVideoRecommendationPrefetches(now);
  const existing = prefetchedVideoRecommendationsByID.get(id);
  if (existing && existing.expiresAt > now) return existing.request;

  const request = fetchVideoRecommendations(id);
  prefetchedVideoRecommendationsByID.set(id, {
    expiresAt: now + VIDEO_RECOMMENDATIONS_PREFETCH_TTL_MS,
    request,
  });
  trimVideoRecommendationPrefetches();

  // Attach a rejection observer immediately: navigation may take long enough
  // for a failed prefetch to settle before the detail component consumes it.
  void request.catch(() => {
    if (prefetchedVideoRecommendationsByID.get(id)?.request === request) {
      prefetchedVideoRecommendationsByID.delete(id);
    }
  });
  return request;
}

export function consumePrefetchedVideoRecommendations(
  id: string
): Promise<VideoItem[]> | null {
  const entry = prefetchedVideoRecommendationsByID.get(id);
  prefetchedVideoRecommendationsByID.delete(id);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.request;
}

function pruneVideoRecommendationPrefetches(now: number) {
  for (const [id, entry] of prefetchedVideoRecommendationsByID) {
    if (entry.expiresAt <= now) {
      prefetchedVideoRecommendationsByID.delete(id);
    }
  }
}

function trimVideoRecommendationPrefetches() {
  while (
    prefetchedVideoRecommendationsByID.size >
    VIDEO_RECOMMENDATIONS_PREFETCH_LIMIT
  ) {
    const oldestID = prefetchedVideoRecommendationsByID.keys().next().value;
    if (!oldestID) return;
    prefetchedVideoRecommendationsByID.delete(oldestID);
  }
}


let cachedTags: TagItem[] | null = null;
let pendingTags: Promise<TagItem[]> | null = null;
let tagCacheVersion = 0;

export function readCachedTags(): TagItem[] | null {
  return cachedTags;
}

export function invalidateTagsCache() {
  tagCacheVersion += 1;
  cachedTags = null;
  pendingTags = null;
}

export function fetchTags(): Promise<TagItem[]> {
  if (cachedTags !== null) {
    return Promise.resolve(cachedTags);
  }
  if (pendingTags) return pendingTags;
  const requestVersion = tagCacheVersion;
  let request!: Promise<TagItem[]>;
  request = client.videos.listTags()
    .then((tags) => {
      if (requestVersion === tagCacheVersion) cachedTags = tags;
      return tags;
    })
    .finally(() => {
      if (pendingTags === request) pendingTags = null;
    });
  pendingTags = request;
  return request;
}
