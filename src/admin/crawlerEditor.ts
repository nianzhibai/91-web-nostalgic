import type { AdminCrawler, CrawlerFeed, ImportCrawlerScriptResult } from "./api";

export type CrawlerEditorForm = {
  scriptPath: string;
  scriptSourceUrl: string;
  name: string;
  feeds: CrawlerFeed[];
  selectedFeedId: string;
  targetNew: string;
  proxy: string;
  uploadProxy: string;
  uploadDriveId: string;
};

export function editorFormFromCrawler(crawler: AdminCrawler | null): CrawlerEditorForm {
  return {
    scriptPath: crawler?.scriptPath ?? "",
    scriptSourceUrl: crawler?.scriptSourceUrl ?? "",
    name: crawler?.name ?? "",
    feeds: crawler?.feeds ?? [],
    selectedFeedId: crawler?.selectedFeedId ?? "",
    targetNew: crawler?.targetNew || "10",
    proxy: crawler?.proxy ?? "",
    uploadProxy: crawler?.uploadProxy ?? "",
    uploadDriveId: crawler?.uploadDriveId ?? "",
  };
}

/** Whether the editor holds edits that closing would discard. */
export function editorFormChanged(form: CrawlerEditorForm, initial: CrawlerEditorForm) {
  return (Object.keys(initial) as (keyof CrawlerEditorForm)[]).some((key) =>
    key === "feeds"
      ? JSON.stringify(form.feeds) !== JSON.stringify(initial.feeds)
      : form[key] !== initial[key]
  );
}

export function editorFormWithImportedScript(
  form: CrawlerEditorForm,
  script: ImportCrawlerScriptResult,
): CrawlerEditorForm {
  return {
    ...form,
    scriptPath: script.scriptPath,
    scriptSourceUrl: script.sourceUrl ?? "",
    name: script.name,
    feeds: script.feeds,
    // Keep an existing selection even if removed, so the user must choose again.
    selectedFeedId: form.selectedFeedId || script.feeds.find(feed => feed.default)?.id || "",
  };
}
