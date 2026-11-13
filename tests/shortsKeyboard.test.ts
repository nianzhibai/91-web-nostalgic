import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { act, render } from "./helpers/dom";
import {
  useShortsKeyboard,
  type ShortsKeyboardOptions,
  type ShortsKeyboardSeekPreview,
} from "../src/shorts/useShortsKeyboard";

type FakeVideo = {
  paused: boolean;
  ended: boolean;
  readyState: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  play: () => Promise<void>;
  pause: () => void;
};

function fakeVideo(currentTime = 30): FakeVideo {
  return {
    paused: false,
    ended: false,
    readyState: 4,
    currentTime,
    duration: 120,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
}

/**
 * 键盘 hook 只通过 options 与页面交互。这里用一条最小的"队列"驱动它：
 * keys[i] 是第 i 屏的 feed key，videos 按 key 取元素。
 */
function setup(t: TestContext) {
  const keys = ["a", "b", "c"];
  const videos = new Map(keys.map((key) => [key, fakeVideo()]));
  const activeIndexRef = { current: 0 };
  const steps: Array<1 | -1> = [];
  const paused = new Set<number>();
  let mutes = 0;
  let preview: ShortsKeyboardSeekPreview | null = null;
  let fastKey: string | null = null;
  let register: ReturnType<typeof useShortsKeyboard>["registerKeyboardLikeHandler"] = () => {};
  const likeButton = { clicks: 0, click() { this.clicks++; } };

  const options: ShortsKeyboardOptions = {
    containerRef: {
      current: {
        querySelector: (selector: string) =>
          selector.includes("[data-shorts-like]") ? likeButton : null,
      } as unknown as HTMLDivElement,
    },
    activeIndexRef,
    getActiveItemKey: () => keys[activeIndexRef.current] ?? "",
    onStep: (direction) => steps.push(direction),
    getVideoAtIndex: (index) =>
      videos.get(keys[index]) as unknown as HTMLVideoElement | undefined,
    isVideoPausedByUser: (index) => paused.has(index),
    setUserPausedForIndex: (index, isPaused) => {
      if (isPaused) paused.add(index);
      else paused.delete(index);
    },
    onToggleMute: () => { mutes++; },
    showHud: () => {},
    isWindowsShortsPlatform: true,
  };

  function Probe() {
    const keyboard = useShortsKeyboard(options);
    preview = keyboard.keyboardSeekPreview;
    fastKey = keyboard.keyboardFastPlaybackKey;
    register = keyboard.registerKeyboardLikeHandler;
    return null;
  }
  let renderer: ReturnType<typeof render>;
  act(() => { renderer = render(createElement(Probe)); });
  t.after(() => act(() => renderer.unmount()));
  t.mock.timers.enable({ apis: ["setTimeout"] });

  function key(type: "keydown" | "keyup", value: string, extra: Partial<KeyboardEvent> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      key: value, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      ...extra,
    });
    act(() => { window.dispatchEvent(event); });
    return event;
  }

  return {
    keys, videos, activeIndexRef, steps, paused, likeButton,
    get mutes() { return mutes; },
    get preview() { return preview; },
    get fastKey() { return fastKey; },
    registerLike(itemKey: string, handler: () => void) {
      act(() => register(itemKey, handler));
    },
    press: (value: string, extra: Partial<KeyboardEvent> = {}) => key("keydown", value, extra),
    release: (value: string) => key("keyup", value),
    advance(ms: number) { act(() => t.mock.timers.tick(ms)); },
    /** 模拟长会话队列裁剪：队首 n 条被删掉，当前屏的索引整体前移。 */
    trimLeading(count: number) {
      keys.splice(0, count);
      activeIndexRef.current -= count;
    },
  };
}

test("browser and system shortcuts with Ctrl, Cmd or Alt are never taken over", t => {
  const h = setup(t);
  h.registerLike("a", () => assert.fail("must not like"));
  const video = h.videos.get("a")!;
  for (const value of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", " ", "m", "M", "l", "L"]) {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      const event = h.press(value, { [modifier]: true });
      assert.equal(event.defaultPrevented, false, `${modifier}+${value}`);
      h.release(value);
    }
  }
  h.advance(2_000);
  assert.deepEqual(h.steps, []);
  assert.equal(h.mutes, 0);
  assert.equal(h.likeButton.clicks, 0, "Ctrl/Cmd+L focuses the address bar instead of unliking");
  assert.equal(video.currentTime, 30, "Alt+← is browser back, not a seek");
  assert.equal(video.paused, false);
});

test("arrow keys page through the pager instead of scrolling the document", t => {
  const h = setup(t);
  assert.equal(h.press("ArrowDown").defaultPrevented, true);
  assert.equal(h.press("ArrowUp").defaultPrevented, true);
  assert.deepEqual(h.steps, [1, -1]);
});

test("a single space toggles playback and a double space likes without toggling", t => {
  const h = setup(t);
  let likes = 0;
  h.registerLike("a", () => { likes++; });
  const video = h.videos.get("a")!;

  h.press(" ");
  h.advance(300);
  assert.equal(video.paused, true);
  assert.equal(h.paused.has(0), true);

  h.press(" ");
  h.advance(100);
  h.press(" ");
  h.advance(500);
  assert.equal(likes, 1);
  assert.equal(video.paused, true, "the like must not resume playback");
});

test("a held left-key seek survives a queue trim that shifts the active index", t => {
  const h = setup(t);
  h.activeIndexRef.current = 2;
  const video = h.videos.get("c")!;
  video.currentTime = 60;

  h.press("ArrowLeft");
  h.press("ArrowLeft", { repeat: true });
  assert.deepEqual(h.preview, { itemKey: "c", currentTime: 50, duration: 120 });

  // 长会话裁剪：同一条视频，索引从 2 变成 0。
  h.trimLeading(2);
  h.press("ArrowLeft", { repeat: true });
  assert.deepEqual(h.preview, { itemKey: "c", currentTime: 45, duration: 120 });
  assert.equal(video.currentTime, 60, "only the release commits a real seek");

  h.release("ArrowLeft");
  assert.equal(video.currentTime, 45);
});

test("a pending seek is dropped once a different video becomes active", t => {
  const h = setup(t);
  const first = h.videos.get("a")!;
  h.press("ArrowLeft");
  h.activeIndexRef.current = 1;
  h.release("ArrowLeft");
  assert.equal(first.currentTime, 30);
});

test("holding the right key plays the active video at 2x and releases back", t => {
  const h = setup(t);
  const video = h.videos.get("a")!;
  h.press("ArrowRight");
  h.advance(450);
  assert.equal(video.playbackRate, 2);
  assert.equal(h.fastKey, "a");
  h.release("ArrowRight");
  assert.equal(video.playbackRate, 1);
  assert.equal(h.fastKey, null);
});
