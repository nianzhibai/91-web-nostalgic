import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { useLocation } from "react-router";
import type { PreviewState } from "@/types";
import { previewController, type PreviewOwner } from "./previewController";
import { usePreviewEnabled } from "./usePreviewEnabled";

type Options = {
  id: string;
  src?: string;
  inView: boolean;
  active?: boolean;
};

// A touch only previews after the finger rests on the card. Scroll flicks move
// beyond the tolerance (or end) before the hold elapses and never start media.
const TOUCH_PREVIEW_HOLD_MS = 280;
const TOUCH_PREVIEW_MOVE_TOLERANCE_PX = 10;

type PendingTouch = { timer: number; x: number; y: number };

/** Each card owns its media; the controller lets only one card play at a time. */
export function useCardPreview({ id, src, inView, active = true }: Options) {
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [shouldRenderPreview, setShouldRenderPreview] = useState(false);
  const [showPreviewLoader, setShowPreviewLoader] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestedRef = useRef(false);
  const previewEnabled = usePreviewEnabled();
  const { pathname } = useLocation();
  const pendingTouchRef = useRef<PendingTouch | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const [owner] = useState<PreviewOwner>(() => ({ stop: () => stopRef.current() }));

  const cancelTouchPreview = useCallback(() => {
    const pending = pendingTouchRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingTouchRef.current = null;
  }, []);

  const stopPreview = useCallback(() => {
    cancelTouchPreview();
    previewController.release(owner);
    requestedRef.current = false;
    const media = videoRef.current;
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    setShouldRenderPreview(false);
    setShowPreviewLoader(false);
    setPreviewState("idle");
  }, [cancelTouchPreview, owner]);
  stopRef.current = stopPreview;

  const startPreview = useCallback(() => {
    if (!previewController.isEnabled() || !src || !active) return;
    if (requestedRef.current) return;
    requestedRef.current = true;
    previewController.claim(owner);
    setShouldRenderPreview(true);
    setShowPreviewLoader(true);
    setPreviewState("loading");
  }, [active, owner, src]);

  const handleTouchStart = useCallback((event: TouchEvent) => {
    cancelTouchPreview();
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch) return;
    pendingTouchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      timer: window.setTimeout(() => {
        pendingTouchRef.current = null;
        startPreview();
      }, TOUCH_PREVIEW_HOLD_MS),
    };
  }, [cancelTouchPreview, startPreview]);

  const handleTouchMove = useCallback((event: TouchEvent) => {
    const pending = pendingTouchRef.current;
    const touch = event.touches[0];
    if (!pending) return;
    if (
      !touch ||
      Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y) >
        TOUCH_PREVIEW_MOVE_TOLERANCE_PX
    ) {
      cancelTouchPreview();
    }
  }, [cancelTouchPreview]);

  useEffect(() => {
    if (!previewEnabled || !active || !inView) stopPreview();
  }, [active, inView, previewEnabled, stopPreview]);

  // Navigation can retain the card tree, and tab switches can merely hide it.
  // Release media on either transition as well as source changes and unmount.
  useEffect(() => stopPreview, [id, pathname, src, stopPreview]);

  const handlePreviewPlay = useCallback(() => setPreviewState("playing"), []);
  const finishPreviewLoader = useCallback(() => setShowPreviewLoader(false), []);

  return {
    touchPreviewHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: cancelTouchPreview,
      onTouchCancel: cancelTouchPreview,
    },
    previewEnabled,
    previewState,
    shouldRenderPreview,
    showPreviewLoader,
    videoRef,
    startPreview,
    stopPreview,
    handlePreviewPlay,
    finishPreviewLoader,
  };
}
