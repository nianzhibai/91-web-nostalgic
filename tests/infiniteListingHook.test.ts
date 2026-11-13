import "./helpers/dom.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, renderHook, waitFor } from "@testing-library/react/pure";
import { clearInfiniteListingCache, useInfiniteListing } from "../src/lib/useInfiniteListing.ts";
import type { InfiniteFeedRequest, InfiniteFeedSource } from "../src/lib/infiniteFeedSource.ts";
import type { VideoItem } from "../src/types.ts";

class ExpiredError extends Error {}

function videos(from: number, count: number): VideoItem[] {
  return Array.from({ length: count }, (_, index) => ({ id: `video-${from + index}` } as VideoItem));
}

function fakeFeed(options: { expireToken?: string } = {}) {
  const requests: InfiniteFeedRequest[] = [];
  let snapshot = 0;
  const fetchBatch: InfiniteFeedSource["fetchBatch"] = async (request) => {
    requests.push(request);
    if (options.expireToken && request.cursor.feedToken === options.expireToken) {
      throw new ExpiredError("expired");
    }
    const token = request.cursor.feedToken || `snapshot-${++snapshot}`;
    const end = request.cursor.position + request.size;
    return {
      items: videos(request.cursor.position, request.size),
      total: 1000,
      cursor: { feedToken: token, position: end },
      exhausted: false,
    };
  };
  const source = (batchSize: number): InfiniteFeedSource => ({
    key: "feed",
    batchSize,
    fetchBatch,
    isExpiredError: (error) => error instanceof ExpiredError,
  });
  return { requests, source };
}

test.beforeEach(() => clearInfiniteListingCache());

test("a page-size change keeps the loaded items and only resizes later batches", async () => {
  const feed = fakeFeed();
  const { result, rerender, unmount } = renderHook(
    ({ size }) => useInfiniteListing(feed.source(size)),
    { initialProps: { size: 14 } }
  );
  await waitFor(() => assert.equal(result.current.items.length, 14));

  rerender({ size: 20 });
  assert.equal(feed.requests.length, 1);
  assert.equal(result.current.items.length, 14);

  act(() => result.current.loadMore());
  await waitFor(() => assert.equal(result.current.items.length, 34));
  assert.deepEqual(feed.requests[1], { cursor: { feedToken: "snapshot-1", position: 14 }, size: 20 });
  unmount();
});

test("an expired snapshot is rebuilt behind the visible items", async () => {
  const feed = fakeFeed({ expireToken: "snapshot-1" });
  const { result, unmount } = renderHook(() => useInfiniteListing(feed.source(10)));
  await waitFor(() => assert.equal(result.current.items.length, 10));

  const seen: number[] = [];
  act(() => result.current.loadMore());
  seen.push(result.current.items.length);
  await waitFor(() => assert.equal(result.current.feedToken, "snapshot-2"));

  assert.ok(seen.every((count) => count > 0), "items must not blank while rebuilding");
  assert.equal(result.current.initialLoading, false);
  assert.deepEqual(feed.requests.at(-1), { cursor: { feedToken: "", position: 0 }, size: 20 });
  assert.deepEqual(result.current.items.map((item) => item.id), videos(0, 20).map((item) => item.id));
  unmount();
});

test("reload after a restored return requests one fresh batch", async () => {
  const feed = fakeFeed();
  const { result, unmount } = renderHook(() =>
    useInfiniteListing(feed.source(12), { restoreCount: 200, restoreFeedToken: "old" })
  );
  await waitFor(() => assert.equal(result.current.items.length, 200));
  assert.deepEqual(feed.requests[0], { cursor: { feedToken: "old", position: 0 }, size: 200 });

  act(() => result.current.reload());
  await waitFor(() => assert.equal(result.current.items.length, 12));
  assert.deepEqual(feed.requests.at(-1), { cursor: { feedToken: "", position: 0 }, size: 12 });
  unmount();
});

test("unmounting aborts a load-more started after hydrating from cache", async () => {
  const feed = fakeFeed();
  const first = renderHook(() => useInfiniteListing(feed.source(10)));
  await waitFor(() => assert.equal(first.result.current.items.length, 10));
  first.unmount();

  let signal: AbortSignal | undefined;
  const source: InfiniteFeedSource = {
    ...feed.source(10),
    fetchBatch: (_request, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  };
  const second = renderHook(() => useInfiniteListing(source));
  assert.equal(second.result.current.items.length, 10);
  act(() => second.result.current.loadMore());
  assert.ok(signal);
  second.unmount();
  assert.equal(signal.aborted, true);
});
