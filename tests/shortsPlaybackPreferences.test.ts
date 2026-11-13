import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { render, act } from "./helpers/dom";
import { useShortsPlaybackPreferences } from "../src/shorts/useShortsPlaybackPreferences";
import { restoreShortsPlaybackRate } from "../src/shorts/playbackRate";

function setup(t: TestContext) {
  const browserDocument = globalThis.document;
  browserDocument.visibilityState = "visible";
  const video = Object.assign(new EventTarget(), {
    defaultPlaybackRate: 1, playbackRate: 1, loop: true, ended: false,
  });
  let advances = 0;
  let options = {
    getVideoElement: () => video as unknown as HTMLVideoElement,
    shouldMount: true,
    usesSharedVideo: false,
    isActive: true,
    canGoNext: true,
    autoAdvance: false,
    playbackRate: 1,
    isTemporarilyAccelerated: false,
    onAdvance: () => { advances++; },
  };
  function Probe() { useShortsPlaybackPreferences(options); return null; }
  let renderer: ReturnType<typeof render>;
  act(() => { renderer = render(createElement(Probe)); });
  t.after(() => act(() => renderer.unmount()));
  return {
    video, browserDocument,
    get advances() { return advances; },
    update(next: Partial<typeof options>) {
      options = { ...options, ...next };
      act(() => renderer.rerender(createElement(Probe)));
    },
    end() { video.ended = true; video.dispatchEvent(new Event("ended")); },
    unmount() { act(() => renderer.unmount()); },
  };
}

test("continuous playback advances only the active visible video at its end", t => {
  const h = setup(t);
  h.end();
  assert.equal(h.advances, 0);
  assert.equal(h.video.loop, true);
  h.update({ autoAdvance: true });
  assert.equal(h.video.loop, false);
  h.video.ended = false;
  h.video.dispatchEvent(new Event("ended"));
  assert.equal(h.advances, 0);
  h.end();
  assert.equal(h.advances, 1);
  h.update({ isActive: false });
  h.end();
  assert.equal(h.advances, 1);
  h.update({ isActive: true });
  h.browserDocument.visibilityState = "hidden";
  h.end();
  assert.equal(h.advances, 1);
});

test("continuous playback loops while the queue loads and responds when the next video arrives", t => {
  const h = setup(t);
  h.update({ autoAdvance: true, canGoNext: false });
  assert.equal(h.video.loop, true);
  h.end();
  assert.equal(h.advances, 0);
  h.update({ canGoNext: true });
  assert.equal(h.video.loop, false);
  h.end();
  assert.equal(h.advances, 1);
  h.update({ autoAdvance: false });
  assert.equal(h.video.loop, true);
  h.end();
  assert.equal(h.advances, 1);
});

test("selected speed survives a temporary boost and applies to the next media element", t => {
  const h = setup(t);
  h.update({ playbackRate: 1.5 });
  assert.equal(h.video.playbackRate, 1.5);
  h.video.playbackRate = 2;
  h.update({ isTemporarilyAccelerated: true, playbackRate: 0.75 });
  assert.equal(h.video.playbackRate, 2);
  restoreShortsPlaybackRate(h.video as unknown as HTMLVideoElement);
  assert.equal(h.video.playbackRate, 0.75);
  const nextVideo = Object.assign(new EventTarget(), {
    defaultPlaybackRate: 1, playbackRate: 1, loop: true, ended: false,
  });
  h.update({
    getVideoElement: () => nextVideo as unknown as HTMLVideoElement,
    isTemporarilyAccelerated: false,
  });
  assert.equal(nextVideo.playbackRate, 0.75);
});

test("desktop preferences leave iOS shared-video loop recovery unchanged and remove listeners on unmount", t => {
  const h = setup(t);
  h.update({ usesSharedVideo: true, playbackRate: 1.5, autoAdvance: true });
  assert.equal(h.video.playbackRate, 1);
  assert.equal(h.video.loop, true);
  h.end();
  assert.equal(h.advances, 0);
  h.update({ usesSharedVideo: false });
  h.unmount();
  h.end();
  assert.equal(h.advances, 0);
});
