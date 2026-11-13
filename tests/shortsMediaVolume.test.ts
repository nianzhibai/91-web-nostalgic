import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { act, render } from "./helpers/dom";
import { useShortsMediaVolume } from "../src/shorts/useShortsMediaVolume";

function media(volume = 1) {
  let writes = 0;
  const video = {
    _volume: volume,
    get volume() { return this._volume; },
    set volume(next: number) { writes++; this._volume = next; },
  };
  return { video, get writes() { return writes; } };
}

function setup(t: TestContext) {
  const videos = { current: new Map<number, HTMLVideoElement>() };
  let volume: number | undefined;
  let apply: (video: HTMLVideoElement) => void = () => {};
  let renders = 0;
  function Probe() {
    renders++;
    apply = useShortsMediaVolume(videos, volume);
    return null;
  }
  let renderer: ReturnType<typeof render>;
  act(() => { renderer = render(createElement(Probe)); });
  t.after(() => act(() => renderer.unmount()));
  return {
    videos,
    get renders() { return renders; },
    get apply() { return apply; },
    mount(index: number, entry: ReturnType<typeof media>) {
      const element = entry.video as unknown as HTMLVideoElement;
      videos.current.set(index, element);
      apply(element);
    },
    setVolume(next: number | undefined) {
      volume = next;
      act(() => renderer.rerender(createElement(Probe)));
    },
  };
}

test("desktop volume reaches every mounted video and each newly mounted one", t => {
  const h = setup(t);
  const current = media();
  const ahead = media();
  h.mount(0, current);
  h.mount(1, ahead);
  h.setVolume(0.35);
  assert.equal(current.video.volume, 0.35);
  assert.equal(ahead.video.volume, 0.35);

  const later = media();
  h.mount(2, later);
  assert.equal(later.video.volume, 0.35);
});

test("the returned applier stays stable while the slider moves", t => {
  const h = setup(t);
  const first = h.apply;
  for (const volume of [0.1, 0.2, 0.3]) h.setVolume(volume);
  assert.equal(h.apply, first);
});

test("mobile leaves loudness to the system and only restores a volume desktop changed", t => {
  const h = setup(t);
  const untouched = media();
  h.mount(0, untouched);
  h.setVolume(undefined);
  assert.equal(untouched.writes, 0);

  h.setVolume(0);
  assert.equal(untouched.video.volume, 0);
  h.setVolume(undefined);
  assert.equal(untouched.video.volume, 1);
  const fresh = media();
  h.mount(1, fresh);
  assert.equal(fresh.writes, 0, "an unchanged volume is not rewritten");
});
