import { useEffect, useRef, type ReactNode } from "react";
import type { ApiError } from "../app/api";
import { Link } from "../app/router";
import type { Remote } from "../app/useApi";
import "./ui.css";

export function PageHeader({
  title,
  eyebrow,
  breadcrumbs,
  actions,
}: {
  title: string;
  eyebrow?: string;
  breadcrumbs?: { href: string; label: string }[];
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <ol>
            {breadcrumbs.map((b) => (
              <li key={b.href}>
                <Link href={b.href}>{b.label}</Link>
              </li>
            ))}
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
      )}
      <div className="page-header__row">
        <div>
          {eyebrow && (
            <span className="label">
              <span className="label__num">—</span> {eyebrow}
            </span>
          )}
          <h1 className="display page-header__title">{title}</h1>
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="section-card" aria-labelledby={id}>
      <div className="section-card__head">
        <h2 id={id} className="section-card__title">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function SummaryCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="summary-card">
      <p className="summary-card__label">{label}</p>
      <p className="summary-card__value">{value}</p>
      {hint && <p className="summary-card__hint">{hint}</p>}
    </div>
  );
}

const STATUS_TONE: Record<string, "good" | "warn" | "muted" | "info"> = {
  active: "good",
  confirmed: "good",
  completed: "muted",
  pending: "warn",
  draft: "info",
  pending_verification: "warn",
  published: "good",
  unpublished: "muted",
  archived: "muted",
  cancelled: "muted",
  expired: "muted",
  verified: "good",
  unverified: "warn",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`status status--${STATUS_TONE[status] ?? "muted"}`}>{label ?? status}</span>;
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** The primary cell becomes the card title on narrow screens. */
  primary?: boolean;
}

/** A table on wide screens that reflows into labelled cards on narrow ones. */
export function RecordList<T extends { id: string }>({
  rows,
  columns,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  caption: string;
}) {
  return (
    <div className="records">
      <table className="records__table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.header} data-label={c.header} className={c.primary ? "records__primary" : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton__line" style={{ width: `${90 - i * 14}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p className="error-state__title">{error.status === 0 ? "You appear to be offline." : "This couldn't be loaded."}</p>
      <p className="error-state__body">{error.message}</p>
      {onRetry && (
        <button type="button" className="btn-plain" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function AccessDenied({ message, homeHref }: { message: string; homeHref: string }) {
  return (
    <div className="denied" role="alert">
      <p className="denied__title">You don't have access to this.</p>
      <p className="denied__body">{message}</p>
      <Link href={homeHref} className="text-link">
        Go to your dashboard
      </Link>
    </div>
  );
}

/** Renders the right state for a Remote value; `ready` gets the data. */
export function Async<T>({
  remote,
  children,
  skeletonLines,
}: {
  remote: Remote<T> & { reload: () => void };
  children: (data: T) => ReactNode;
  skeletonLines?: number;
}) {
  if (remote.status === "loading") return <Skeleton lines={skeletonLines} />;
  if (remote.status === "error") return <ErrorState error={remote.error} onRetry={remote.reload} />;
  return <>{children(remote.data)}</>;
}

/** Modal confirmation for destructive actions, built on the native <dialog>. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // jsdom lacks showModal; fall back to the open attribute.
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-title" className="confirm__title">
        {title}
      </h2>
      <div className="confirm__body">{body}</div>
      <div className="confirm__actions">
        <button type="button" className="btn-plain" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
