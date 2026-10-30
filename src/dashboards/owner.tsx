import { useEffect, useState } from "react";
import { api } from "../app/api";
import { formatMoney, formatRange } from "../app/format";
import { Link } from "../app/router";
import { isUpcoming, type Booking, type PageMeta } from "../app/types";
import { useApi } from "../app/useApi";
import { usePageTitle } from "../pages/Field";
import { BookingStatusBadge, BookingViewFilter, filterBookings, type BookingView } from "./booking";
import { Async, EmptyState, PageHeader, RecordList, Section, Skeleton, SummaryCard, type Column } from "../ui/ui";

const NewListing = () => (
  <Link href="/app/owner/spaces/new" className="btn-primary">
    New listing
  </Link>
);

// Owners see the slot, never the customer: the API omits booker identity here.
const activityColumns: Column<Booking>[] = [
  { header: "Space", primary: true, cell: (b) => <Link href={`/app/bookings/${b.id}`}>{b.spaceName}</Link> },
  { header: "Bay", cell: (b) => b.bayLabel },
  { header: "When", cell: (b) => formatRange(b.startsAt, b.endsAt) },
  { header: "Status", cell: (b) => <BookingStatusBadge status={b.status} /> },
  { header: "Total", cell: (b) => formatMoney(b.price.totalAmountMinor, b.price.currency) },
];

const respondColumn: Column<Booking> = {
  header: "Action",
  cell: (b) =>
    b.status === "pending" ? (
      <Link href={`/app/bookings/${b.id}`} className="text-link">
        Respond
      </Link>
    ) : (
      "—"
    ),
};

/** Listing counts straight from the paginated API totals (exact, not sampled). */
function useListingCounts() {
  const [counts, setCounts] = useState<{ all: number; published: number; review: number } | "error" | null>(null);
  useEffect(() => {
    let live = true;
    const total = (q: string) => api<{ page: PageMeta }>(`/me/parking-spaces?pageSize=1${q}`).then((r) => r.page.total);
    Promise.all([total(""), total("&status=published"), total("&status=pending_verification")])
      .then(([all, published, review]) => live && setCounts({ all, published, review }))
      .catch(() => live && setCounts("error"));
    return () => {
      live = false;
    };
  }, []);
  return counts;
}

export function OwnerHome() {
  usePageTitle("Owner overview");
  const counts = useListingCounts();
  const activity = useApi<Booking[]>("/me/space-bookings");
  return (
    <>
      <PageHeader eyebrow="Parking owner" title="Your parking." actions={<NewListing />} />
      {counts === null ? (
        <Skeleton lines={2} />
      ) : counts === "error" ? (
        <p className="muted-text" role="alert">
          Couldn't load your listing counts.
        </p>
      ) : counts.all === 0 ? (
        <Section title="Get started">
          <EmptyState
            title="You haven't listed a space yet"
            body="Create a listing with its address, vehicles and price. It starts as a private draft; once you submit it, SpotSure reviews it before drivers can see it."
            action={<NewListing />}
          />
        </Section>
      ) : (
        <div className="summary-grid">
          <SummaryCard label="Listings" value={counts.all} />
          <SummaryCard label="Published" value={counts.published} hint="Visible to drivers" />
          <SummaryCard label="In review" value={counts.review} />
          <SummaryCard
            label="Requests waiting"
            value={activity.status === "ready" ? activity.data.filter((b) => b.status === "pending").length : "–"}
            hint="Confirm or decline from Booking activity"
          />
          <SummaryCard
            label="Confirmed upcoming"
            value={activity.status === "ready" ? activity.data.filter((b) => isUpcoming(b) && b.status !== "pending").length : "–"}
          />
        </div>
      )}
      <Section
        title="Recent booking activity"
        actions={
          <Link href="/app/owner/bookings" className="text-link">
            All activity
          </Link>
        }
      >
        <Async remote={activity}>
          {(rows) =>
            rows.length ? (
              <RecordList rows={rows.slice(0, 5)} columns={activityColumns} caption="Recent bookings on your spaces" />
            ) : (
              <EmptyState title="No bookings on your spaces yet" body="Bookings made on your listings will appear here." />
            )
          }
        </Async>
      </Section>
    </>
  );
}

export function OwnerBookings() {
  usePageTitle("Booking activity");
  const activity = useApi<Booking[]>("/me/space-bookings");
  const [view, setView] = useState<BookingView | null>(null);
  return (
    <>
      <PageHeader title="Booking activity" breadcrumbs={[{ href: "/app/owner", label: "Overview" }]} />
      <Section title="Bookings on your spaces">
        <Async remote={activity} skeletonLines={4}>
          {(rows) => {
            if (!rows.length) return <EmptyState title="No bookings yet" body="Booking requests on your listings will appear here." />;
            // Open on the requests that need an answer, when there are any.
            const current = view ?? (rows.some((b) => b.status === "pending") ? "requests" : "all");
            const shown = filterBookings(rows, current);
            return (
              <>
                <BookingViewFilter value={current} onChange={setView} rows={rows} />
                {shown.length ? (
                  <RecordList rows={shown} columns={[...activityColumns, respondColumn]} caption="Bookings on your spaces" />
                ) : (
                  <EmptyState title="Nothing here" body="No bookings match this filter." />
                )}
              </>
            );
          }}
        </Async>
      </Section>
    </>
  );
}
