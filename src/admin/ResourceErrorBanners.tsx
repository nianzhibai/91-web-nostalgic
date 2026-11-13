export type ResourceFailure = {
  /** Prefix such as "标签更新失败"; omitted when the error explains itself. */
  label?: string;
  error: string | null | undefined | false;
  retry: () => unknown;
};

/** Inline banners for background reads that failed while older data stays visible. */
export function ResourceErrorBanners({ failures }: { failures: ResourceFailure[] }) {
  return (
    <>
      {failures.map(({ label, error, retry }, index) => error ? (
        <div className="admin-detail-error" role="alert" key={index}>
          {label && `${label}：`}{error}
          <button type="button" className="admin-btn" onClick={() => void retry()}>重试</button>
        </div>
      ) : null)}
    </>
  );
}
