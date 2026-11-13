import { useCallback, useEffect, useRef } from "react";

/**
 * 桌面音量统一写到页面已挂载的 `<video>` 上，而不是作为 prop 发给每一条
 * slide：拖动音量条时只改媒体元素，整条队列不会逐帧重渲染。
 *
 * `volume` 为 undefined 表示手机布局：响度交给系统，从不主动写入；只有之前
 * 在桌面布局下设过音量，缩回手机布局时才还原成 1。iOS 共享 video 不在
 * `videos` 里，它的音量本来就由系统控制。
 *
 * 返回的函数用于新挂载的元素：在 ref 回调里调用一次即可拿到当前音量。
 */
export function useShortsMediaVolume(
  videos: React.RefObject<Map<number, HTMLVideoElement>>,
  volume: number | undefined
) {
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const controlledRef = useRef(false);

  const applyVolume = useCallback((video: HTMLVideoElement) => {
    const current = volumeRef.current;
    if (current === undefined && !controlledRef.current) return;
    writeVolume(video, current ?? 1);
  }, []);

  useEffect(() => {
    if (volume === undefined && !controlledRef.current) return;
    videos.current?.forEach((video) => writeVolume(video, volume ?? 1));
    controlledRef.current = volume !== undefined;
  }, [videos, volume]);

  return applyVolume;
}

function writeVolume(video: HTMLVideoElement, volume: number) {
  try {
    if (video.volume !== volume) video.volume = volume;
  } catch {
    // 部分平台的 volume 只读。
  }
}
