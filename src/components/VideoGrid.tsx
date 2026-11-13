import { useEffect } from "react";
import type { VideoItem } from "@/types";
import { scheduleVideoDetailPagePreload } from "@/lib/videoDetailRoute";
import { VideoCard } from "./VideoCard";

type Props = {
  videos: VideoItem[];
  loading?: boolean;
  emptyText?: string;
  eagerCount?: number;
  highPriorityCount?: number;
  skeletonCount?: number;
};

export function VideoGrid({
  videos,
  loading,
  emptyText = "暂时没有视频",
  eagerCount = 0,
  highPriorityCount = 0,
  skeletonCount = 8,
}: Props) {
  useEffect(() => {
    scheduleVideoDetailPagePreload();
  }, []);

  if (loading) {
    return (
      <div
        className="video-grid-loading"
        aria-busy="true"
        role="status"
        aria-label="正在加载视频列表"
      >
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="skeleton-card" aria-hidden="true">
            <span className="skeleton-card__thumb" />
            <div className="skeleton-card__body">
              <span className="skeleton-card__title" />
              <span className="skeleton-card__meta" />
              <span className="skeleton-card__meta" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!videos || videos.length === 0) {
    return <div className="video-grid-empty">{emptyText}</div>;
  }

  return (
    <div className="video-grid-region">
      <div className="video-grid">
        {(videos ?? []).map((v, index) => (
          <VideoCard
            key={v.id}
            video={v}
            eager={index < eagerCount}
            highPriority={index < highPriorityCount}
          />
        ))}
      </div>
    </div>
  );
}
