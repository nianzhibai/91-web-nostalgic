import { useEffect, useState } from "react";

/**
 * Media queries shared by components and their CSS. Each must stay identical
 * to the matching `@media` rule so script and stylesheet switch together.
 */
/** One-column video grid (`video-card.css`). */
export const SINGLE_COLUMN_GRID_QUERY = "(max-width: 767px)";
/** Three-column video grid (`video-card.css`). */
export const TABLET_GRID_QUERY = "(max-width: 991px)";
/** Bottom navigation and mobile-only sheets (`navigation.css`). */
export const MOBILE_NAV_QUERY = "(max-width: 768px)";

export const MOBILE_VIDEO_PAGE_SIZE = 14;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

/** True while the video grid shows a single column; drives batch and eager sizes. */
export function useIsMobile(): boolean {
  return useMediaQuery(SINGLE_COLUMN_GRID_QUERY);
}
