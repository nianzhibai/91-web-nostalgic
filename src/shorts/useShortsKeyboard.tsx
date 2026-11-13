import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Sparkles } from "lucide-react";
import { clamp } from "./mediaBuffer";
import { restoreShortsPlaybackRate } from "./playbackRate";
import { SHORTS_ACTION_SHORTCUTS, SHORTS_CONTROL_SHORTCUTS } from "./controlShortcuts";

const SHORTS_KEYBOARD_SEEK_SECONDS = 5;
const SHORTS_KEYBOARD_FAST_PLAYBACK_DELAY_MS = 400;
// 浏览器失焦时可能收不到 keyup；左键最后一次重复事件后自动提交，避免目标悬空。
const SHORTS_KEYBOARD_SEEK_IDLE_COMMIT_MS = 1500;
const SHORTS_KEYBOARD_SEEK_RELEASE_HIDE_MS = 400;
const SHORTS_KEYBOARD_DOUBLE_SPACE_MS = 280;

type ShortsKeyboardSeekKey = "ArrowLeft" | "ArrowRight";

/**
 * 键盘目标一律按 feed key（加 video 元素）认人，不按索引：长会话队列裁剪会
 * 整体平移索引，但同一条视频的 key 不变，长按中的累计 seek 不会因此作废。
 */
export type ShortsKeyboardSeekPreview = {
  itemKey: string;
  currentTime: number;
  duration: number;
};

type ShortsKeyboardVideoTarget = {
  itemKey: string;
  video: HTMLVideoElement;
};

type ShortsKeyboardSeekTarget = ShortsKeyboardSeekPreview & ShortsKeyboardVideoTarget;

export type ShortsKeyboardOptions = {
  resetKey?: string;
  /** 滚动容器：用于定位当前屏的点赞按钮与侧栏操作 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeIndexRef: React.MutableRefObject<number>;
  /** 当前屏的 feed key；队列裁剪后仍指向同一条视频。 */
  getActiveItemKey: () => string;
  /** ↑/↓ 翻到相邻一屏；由翻页器负责动画与越界。 */
  onStep: (direction: 1 | -1) => void;
  /** 返回某索引当前生效的 video 元素（iOS 分支返回共享节点） */
  getVideoAtIndex: (index: number) => HTMLVideoElement | undefined;
  isVideoPausedByUser: (index: number) => boolean;
  setUserPausedForIndex: (index: number, isPaused: boolean) => void;
  onToggleMute: () => void;
  /** 仅桌面页面提供，缺省时不接管这些按键。 */
  onToggleAutoAdvance?: () => void;
  onToggleClearScreen?: () => void;
  onToggleFullscreen?: () => void;
  enableSidebarShortcuts?: boolean;
  showHud: (text: string, icon?: ReactNode) => void;
  isWindowsShortsPlatform: boolean;
};

/**
 * 短视频页的键盘快捷键：
 * - ↑/↓ 切换上下视频，空格播放/暂停（双空格点赞），M 静音，L 点赞
 * - 桌面 K 连播、J 清屏、H 全屏；D 来源、S 分享、X 隐藏
 * - ← 按键重复时累计快退 5s/次，松开（或失焦/超时）后提交一次真实 seek
 * - → 短按快进 5s；按住 400ms 后以 2 倍速播放，松开恢复 1 倍速
 */
export function useShortsKeyboard(options: ShortsKeyboardOptions) {
  const [keyboardSeekPreview, setKeyboardSeekPreview] =
    useState<ShortsKeyboardSeekPreview | null>(null);
  const [keyboardFastPlaybackKey, setKeyboardFastPlaybackKey] =
    useState<string | null>(null);
  const keyboardSeekTargetRef = useRef<ShortsKeyboardSeekTarget | null>(null);
  const keyboardSeekHeldKeysRef = useRef<Set<ShortsKeyboardSeekKey>>(new Set());
  const keyboardSeekCommitTimerRef = useRef<number | null>(null);
  const keyboardSeekHideTimerRef = useRef<number | null>(null);
  const keyboardLikeHandlersRef = useRef<Map<string, () => void>>(new Map());
  const registerKeyboardLikeHandler = useCallback(
    (itemKey: string, handler: (() => void) | null) => {
      if (handler) {
        keyboardLikeHandlersRef.current.set(itemKey, handler);
      } else {
        keyboardLikeHandlersRef.current.delete(itemKey);
      }
    },
    []
  );
  // 同一队列内只绑定一次；回调经由这里读取每次渲染的最新配置。
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 键盘快捷键监听
  useEffect(() => {
    setKeyboardSeekPreview(null);
    setKeyboardFastPlaybackKey(null);
    const { activeIndexRef, containerRef } = optionsRef.current;
    const isVideoPausedByUser = (videoIndex: number) =>
      optionsRef.current.isVideoPausedByUser(videoIndex);
    const setUserPausedForIndex = (videoIndex: number, isPaused: boolean) =>
      optionsRef.current.setUserPausedForIndex(videoIndex, isPaused);
    const showHud = (text: string, icon?: ReactNode) =>
      optionsRef.current.showHud(text, icon);

    /** 当前屏的 key 与实际播放元素；没有可操作的视频时为 null。 */
    const readActiveTarget = (): ShortsKeyboardVideoTarget | null => {
      const video = optionsRef.current.getVideoAtIndex(activeIndexRef.current);
      if (!video) return null;
      return { itemKey: optionsRef.current.getActiveItemKey(), video };
    };
    /** 目标仍是当前屏、且仍由同一个元素播放。 */
    const isActiveTarget = (target: ShortsKeyboardVideoTarget) => {
      const active = readActiveTarget();
      return active?.itemKey === target.itemKey && active.video === target.video;
    };

    let pendingSpaceTimer: number | null = null;
    let pendingSpaceTarget: ShortsKeyboardVideoTarget | null = null;
    let keyboardRightPressTimer: number | null = null;
    let keyboardRightPressTarget: (ShortsKeyboardVideoTarget & {
      fastPlaybackActive: boolean;
    }) | null = null;

    const clearKeyboardSeekCommitTimer = () => {
      if (keyboardSeekCommitTimerRef.current === null) return;
      window.clearTimeout(keyboardSeekCommitTimerRef.current);
      keyboardSeekCommitTimerRef.current = null;
    };

    const scheduleKeyboardSeekPreviewHide = (delay: number) => {
      if (keyboardSeekHideTimerRef.current !== null) {
        window.clearTimeout(keyboardSeekHideTimerRef.current);
      }
      keyboardSeekHideTimerRef.current = window.setTimeout(() => {
        keyboardSeekHideTimerRef.current = null;
        setKeyboardSeekPreview(null);
      }, delay);
    };

    const clearKeyboardSpaceTimer = () => {
      if (pendingSpaceTimer !== null) {
        window.clearTimeout(pendingSpaceTimer);
      }
      pendingSpaceTimer = null;
      pendingSpaceTarget = null;
    };

    const getActiveLikeButton = () =>
      containerRef.current?.querySelector<HTMLButtonElement>(
        `[data-index="${activeIndexRef.current}"] [data-shorts-like]`
      ) ?? null;

    const likeVideo = (itemKey: string) => {
      keyboardLikeHandlersRef.current.get(itemKey)?.();
    };

    const toggleKeyboardPlayback = (target: ShortsKeyboardVideoTarget) => {
      if (!isActiveTarget(target)) return;

      const videoIndex = activeIndexRef.current;
      const shouldResume =
        isVideoPausedByUser(videoIndex) ||
        (target.video.paused && target.video.readyState >= 3);
      if (shouldResume) {
        setUserPausedForIndex(videoIndex, false);
        target.video.play().catch(() => undefined);
      } else {
        setUserPausedForIndex(videoIndex, true);
        target.video.pause();
      }
    };

    const scheduleKeyboardSpaceToggle = (target: ShortsKeyboardVideoTarget) => {
      pendingSpaceTarget = target;
      pendingSpaceTimer = window.setTimeout(() => {
        const target = pendingSpaceTarget;
        pendingSpaceTimer = null;
        pendingSpaceTarget = null;
        if (target) toggleKeyboardPlayback(target);
      }, SHORTS_KEYBOARD_DOUBLE_SPACE_MS);
    };

    const discardKeyboardSeek = () => {
      clearKeyboardSeekCommitTimer();
      keyboardSeekTargetRef.current = null;
      keyboardSeekHeldKeysRef.current.clear();
    };

    const commitKeyboardSeek = () => {
      const target = keyboardSeekTargetRef.current;
      if (!target) return false;

      discardKeyboardSeek();
      if (isActiveTarget(target)) {
        const duration =
          Number.isFinite(target.video.duration) && target.video.duration > 0
            ? target.video.duration
            : target.duration;
        const nextTime = clamp(target.currentTime, 0, duration);
        try {
          // 左键连按期间只更新预览；松开后才执行这一次真实 seek。
          target.video.currentTime = nextTime;
        } catch {
          // ignore（部分 ready state 下设置会抛错）
        }
      }
      return true;
    };

    const finishKeyboardSeek = () => {
      if (!commitKeyboardSeek()) return;
      scheduleKeyboardSeekPreviewHide(SHORTS_KEYBOARD_SEEK_RELEASE_HIDE_MS);
    };

    const scheduleKeyboardSeekIdleCommit = () => {
      clearKeyboardSeekCommitTimer();
      keyboardSeekCommitTimerRef.current = window.setTimeout(() => {
        keyboardSeekCommitTimerRef.current = null;
        finishKeyboardSeek();
      }, SHORTS_KEYBOARD_SEEK_IDLE_COMMIT_MS);
    };

    const previewKeyboardSeek = (
      delta: number,
      key: ShortsKeyboardSeekKey
    ) => {
      const active = readActiveTarget();
      const duration = active?.video.duration ?? 0;
      if (!active || !Number.isFinite(duration) || duration <= 0) return;
      const { itemKey, video: activeVideo } = active;

      if (keyboardSeekHideTimerRef.current !== null) {
        window.clearTimeout(keyboardSeekHideTimerRef.current);
        keyboardSeekHideTimerRef.current = null;
      }

      const pendingTarget = keyboardSeekTargetRef.current;
      const canContinuePendingTarget =
        pendingTarget?.itemKey === itemKey &&
        pendingTarget.video === activeVideo;
      if (pendingTarget && !canContinuePendingTarget) {
        discardKeyboardSeek();
      }

      keyboardSeekHeldKeysRef.current.add(key);
      const baseTime = canContinuePendingTarget
        ? pendingTarget.currentTime
        : activeVideo.currentTime;
      const currentTime = clamp(baseTime + delta, 0, duration);
      keyboardSeekTargetRef.current = { itemKey, video: activeVideo, currentTime, duration };
      setKeyboardSeekPreview({ itemKey, currentTime, duration });
      if (!optionsRef.current.isWindowsShortsPlatform) {
        showHud(
          delta > 0 ? "+5秒" : "-5秒",
          <Sparkles size={16} />
        );
      }
      scheduleKeyboardSeekIdleCommit();
    };

    const clearKeyboardRightPressTimer = () => {
      if (keyboardRightPressTimer === null) return;
      window.clearTimeout(keyboardRightPressTimer);
      keyboardRightPressTimer = null;
    };

    const finishKeyboardRightPress = (seekOnShortPress: boolean) => {
      clearKeyboardRightPressTimer();
      const target = keyboardRightPressTarget;
      keyboardRightPressTarget = null;
      if (!target) return;

      if (target.fastPlaybackActive) {
        try {
          restoreShortsPlaybackRate(target.video);
        } catch {
          // ignore
        }
        setKeyboardFastPlaybackKey(null);
        return;
      }

      if (seekOnShortPress && isActiveTarget(target)) {
        previewKeyboardSeek(
          SHORTS_KEYBOARD_SEEK_SECONDS,
          "ArrowRight"
        );
        keyboardSeekHeldKeysRef.current.delete("ArrowRight");
        finishKeyboardSeek();
      }
    };

    const startKeyboardRightPress = () => {
      if (keyboardRightPressTarget) return;
      finishKeyboardSeek();
      const active = readActiveTarget();
      if (!active) return;

      keyboardRightPressTarget = { ...active, fastPlaybackActive: false };
      keyboardRightPressTimer = window.setTimeout(() => {
        keyboardRightPressTimer = null;
        const target = keyboardRightPressTarget;
        if (
          !target ||
          !isActiveTarget(target) ||
          target.video.paused ||
          target.video.ended
        ) {
          return;
        }
        try {
          target.video.playbackRate = 2;
        } catch {
          return;
        }
        target.fastPlaybackActive = true;
        setKeyboardFastPlaybackKey(target.itemKey);
      }, SHORTS_KEYBOARD_FAST_PLAYBACK_DELAY_MS);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          (activeEl instanceof HTMLElement && activeEl.isContentEditable))
      ) {
        return;
      }
      // 带 Ctrl/Cmd/Alt 的组合键属于浏览器和系统（Ctrl+L 聚焦地址栏、Alt+←
      // 后退、Cmd+↑ 等），一律不接管。
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toUpperCase();
      const desktopAction = key === SHORTS_CONTROL_SHORTCUTS.autoAdvance
        ? optionsRef.current.onToggleAutoAdvance
        : key === SHORTS_CONTROL_SHORTCUTS.clearScreen
          ? optionsRef.current.onToggleClearScreen
          : key === SHORTS_CONTROL_SHORTCUTS.fullscreen
            ? optionsRef.current.onToggleFullscreen
            : undefined;
      if (desktopAction) {
        e.preventDefault();
        if (!e.repeat) desktopAction();
        return;
      }
      const sidebarShortcut = [
        SHORTS_ACTION_SHORTCUTS.source, SHORTS_ACTION_SHORTCUTS.share, SHORTS_ACTION_SHORTCUTS.hide,
      ].some((shortcut) => shortcut === key);
      if (optionsRef.current.enableSidebarShortcuts && sidebarShortcut) {
        // 使用当前视频实际渲染的控件，沿用其权限、禁用状态和原有点击流程。
        const action = containerRef.current?.querySelector<HTMLElement>(
          `[data-index="${activeIndexRef.current}"][data-active="true"] [data-shorts-shortcut="${key}"]`
        );
        if (action && !action.matches(":disabled") && action.getAttribute("aria-disabled") !== "true") {
          e.preventDefault();
          if (!e.repeat) {
            finishKeyboardRightPress(false);
            finishKeyboardSeek();
            action.click();
          }
          return;
        }
      }
      // 空格优先激活已聚焦的按钮/链接，避免桌面控件触发后又切换播放状态。
      if (
        e.key === " " &&
        activeEl instanceof HTMLElement &&
        activeEl.closest('button, a, summary, [role="button"]')
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        finishKeyboardRightPress(false);
        finishKeyboardSeek();
        optionsRef.current.onStep(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === " ") {
        e.preventDefault();
        finishKeyboardRightPress(false);
        finishKeyboardSeek();
        if (e.repeat) return;
        const active = readActiveTarget();
        if (!active) {
          clearKeyboardSpaceTimer();
          return;
        }

        if (
          pendingSpaceTimer !== null &&
          pendingSpaceTarget?.itemKey === active.itemKey &&
          pendingSpaceTarget.video === active.video
        ) {
          clearKeyboardSpaceTimer();
          likeVideo(active.itemKey);
          return;
        }

        clearKeyboardSpaceTimer();
        scheduleKeyboardSpaceToggle(active);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        finishKeyboardRightPress(false);
        finishKeyboardSeek();
        if (e.repeat) return;
        optionsRef.current.onToggleMute();
      } else if (key === SHORTS_ACTION_SHORTCUTS.like) {
        e.preventDefault();
        finishKeyboardRightPress(false);
        finishKeyboardSeek();
        if (e.repeat) return;
        getActiveLikeButton()?.click();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.repeat) return;
        startKeyboardRightPress();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        finishKeyboardRightPress(false);
        previewKeyboardSeek(
          -SHORTS_KEYBOARD_SEEK_SECONDS,
          "ArrowLeft"
        );
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        if (!keyboardRightPressTarget) return;
        e.preventDefault();
        finishKeyboardRightPress(true);
        return;
      }
      if (e.key !== "ArrowLeft") return;
      if (!keyboardSeekTargetRef.current) return;

      e.preventDefault();
      keyboardSeekHeldKeysRef.current.delete(e.key);
      if (keyboardSeekHeldKeysRef.current.size === 0) finishKeyboardSeek();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) return;
      finishKeyboardRightPress(false);
      finishKeyboardSeek();
      clearKeyboardSpaceTimer();
    };

    const handleWindowBlur = () => {
      finishKeyboardRightPress(false);
      finishKeyboardSeek();
      clearKeyboardSpaceTimer();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearKeyboardSpaceTimer();
      finishKeyboardRightPress(false);
      // 卸载时同步清掉累计 seek 的定时器与目标，避免悬空提交
      clearKeyboardSeekCommitTimer();
      if (keyboardSeekHideTimerRef.current !== null) {
        window.clearTimeout(keyboardSeekHideTimerRef.current);
        keyboardSeekHideTimerRef.current = null;
      }
      keyboardSeekTargetRef.current = null;
      keyboardSeekHeldKeysRef.current.clear();
    };
  }, [options.resetKey]);

  return {
    keyboardSeekPreview,
    keyboardFastPlaybackKey,
    registerKeyboardLikeHandler,
  };
}
