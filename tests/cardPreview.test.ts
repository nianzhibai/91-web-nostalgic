import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, fireEvent, render } from "./helpers/dom";
import { MemoryRouter, useNavigate } from "react-router";
import { useCardPreview } from "../src/lib/useCardPreview.ts";
import { previewController } from "../src/lib/previewController.ts";
import { PreviewLoader } from "../src/components/PreviewLoader";

test("preview loaders finish only after the fade animation ends", () => {
  let finishes = 0;
  const { container } = render(createElement(PreviewLoader, { onFinish: () => { finishes++; } }));
  const loader = container.firstElementChild!;
  for (const name of ["preview-startup-fill", "preview-startup-fade"]) {
    fireEvent.animationEnd(loader, { animationName: name });
    assert.equal(finishes, name === "preview-startup-fade" ? 1 : 0);
  }
});

function previewHarness() {
  const cards = new Map<string, ReturnType<typeof useCardPreview>>();
  const media = new Map<string, ReturnType<typeof fakeMedia>>();
  let navigate!: ReturnType<typeof useNavigate>;
  let firstActive = true;
  let firstInView = true;
  let firstSource = "/first.mp4";

  function fakeMedia() {
    return {
      paused: false,
      src: "/preview.mp4",
      pause() { this.paused = true; },
      removeAttribute() { this.src = ""; },
      load() {},
    };
  }

  function Card({ id }: { id: string }) {
    const preview = useCardPreview({
      id,
      src: id === "first" ? firstSource : "/second.mp4",
      active: id === "first" ? firstActive : true,
      inView: id === "first" ? firstInView : true,
    });
    cards.set(id, preview);
    if (!media.has(id)) media.set(id, fakeMedia());
    preview.videoRef.current = media.get(id) as unknown as HTMLVideoElement;
    return null;
  }

  function Harness() {
    navigate = useNavigate();
    return createElement("div", null,
      createElement(Card, { id: "first" }), createElement(Card, { id: "second" }));
  }

  const tree = () => createElement(MemoryRouter, { initialEntries: ["/video/current"] }, createElement(Harness));
  let renderer!: ReturnType<typeof render>;
  act(() => { renderer = render(tree()); });
  return {
    card: (id: string) => cards.get(id)!,
    media: (id: string) => media.get(id)!,
    startBoth() {
      act(() => {
        cards.get("first")!.startPreview();
        cards.get("second")!.startPreview();
      });
    },
    updateFirst(options: { active?: boolean; inView?: boolean; src?: string }) {
      firstActive = options.active ?? firstActive;
      firstInView = options.inView ?? firstInView;
      firstSource = options.src ?? firstSource;
      act(() => { renderer.rerender(tree()); });
    },
    navigate: (path: string) => act(() => navigate(path)),
    close: () => act(() => renderer.unmount()),
  };
}

const start = (harness: ReturnType<typeof previewHarness>, id: string) =>
  act(() => harness.card(id).startPreview());

test("only one card previews at a time and the global switch releases every card", () => {
  previewController.setEnabled(true);
  const harness = previewHarness();
  try {
    start(harness, "first");
    assert.equal(harness.card("first").shouldRenderPreview, true);
    start(harness, "second");
    assert.equal(harness.card("first").shouldRenderPreview, false);
    assert.equal(harness.media("first").src, "");
    assert.equal(harness.card("second").shouldRenderPreview, true);
    act(() => harness.card("second").stopPreview());
    assert.equal(harness.card("second").shouldRenderPreview, false);
    start(harness, "first");
    act(() => previewController.setEnabled(false));
    for (const id of ["first", "second"]) {
      assert.equal(harness.card(id).shouldRenderPreview, false);
      assert.equal(harness.card(id).showPreviewLoader, false);
      assert.equal(harness.media(id).paused, true);
      assert.equal(harness.media(id).src, "");
    }
    harness.startBoth();
    assert.equal(harness.card("first").shouldRenderPreview, false);
    assert.equal(harness.card("second").shouldRenderPreview, false);
  } finally { harness.close(); previewController.setEnabled(false); }
});

test("hidden panels, offscreen cards and retained navigation release their previews", () => {
  previewController.setEnabled(true);
  const harness = previewHarness();
  try {
    start(harness, "first");
    harness.updateFirst({ active: false });
    assert.equal(harness.card("first").shouldRenderPreview, false);
    start(harness, "first");
    assert.equal(harness.card("first").shouldRenderPreview, false);
    harness.updateFirst({ active: true });
    start(harness, "second");
    harness.updateFirst({ active: false });
    assert.equal(harness.card("second").shouldRenderPreview, true);
    harness.updateFirst({ active: true });
    start(harness, "first");
    harness.updateFirst({ inView: false });
    assert.equal(harness.card("first").shouldRenderPreview, false);
    harness.updateFirst({ inView: true });
    start(harness, "second");
    harness.navigate("/video/next");
    assert.equal(harness.card("second").shouldRenderPreview, false);
  } finally { harness.close(); previewController.setEnabled(false); }
});

test("new sources reset playback and repeated contact does not restart the loader", () => {
  previewController.setEnabled(true);
  const harness = previewHarness();
  try {
    start(harness, "first");
    act(() => {
      harness.card("first").handlePreviewPlay();
      harness.card("first").finishPreviewLoader();
    });
    start(harness, "first");
    assert.equal(harness.card("first").previewState, "playing");
    assert.equal(harness.card("first").showPreviewLoader, false);
    harness.updateFirst({ src: "/replacement.mp4" });
    assert.equal(harness.card("first").shouldRenderPreview, false);
    harness.updateFirst({ src: "" });
    start(harness, "first");
    assert.equal(harness.card("first").shouldRenderPreview, false);
  } finally { harness.close(); previewController.setEnabled(false); }
});

test("touch previews start only after a still hold, never while scrolling", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(window, "setTimeout", (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  t.mock.method(window, "clearTimeout", (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id));
  previewController.setEnabled(true);
  let preview!: ReturnType<typeof useCardPreview>;
  function TouchCard() {
    preview = useCardPreview({ id: "touch", src: "/touch.mp4", inView: true });
    return createElement("div", { "data-testid": "card", ...preview.touchPreviewHandlers });
  }
  let view!: ReturnType<typeof render>;
  act(() => {
    view = render(createElement(MemoryRouter, null, createElement(TouchCard)));
  });
  const card = view.getByTestId("card");
  const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
  try {
    // A flick moves past the tolerance before the hold elapses.
    fireEvent.touchStart(card, touch(10, 100));
    fireEvent.touchMove(card, touch(10, 60));
    act(() => t.mock.timers.tick(1000));
    assert.equal(preview.shouldRenderPreview, false);

    // A tap ends before the hold elapses.
    fireEvent.touchStart(card, touch(10, 100));
    fireEvent.touchEnd(card, { touches: [] });
    act(() => t.mock.timers.tick(1000));
    assert.equal(preview.shouldRenderPreview, false);

    // A resting finger (small jitter allowed) starts the preview.
    fireEvent.touchStart(card, touch(10, 100));
    fireEvent.touchMove(card, touch(13, 103));
    act(() => t.mock.timers.tick(1000));
    assert.equal(preview.shouldRenderPreview, true);
  } finally { view.unmount(); previewController.setEnabled(false); }
});
