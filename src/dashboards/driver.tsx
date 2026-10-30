import { useState } from "react";
import type { User } from "../app/api";
import { formatMoney, formatRange } from "../app/format";
import { Link } from "../app/router";
import { isUpcoming, type Booking } from "../app/types";
import { useApi } from "../app/useApi";
import { usePageTitle } from "../pages/Field";
import { BookingStatusBadge, BookingViewFilter, filterBookings, type BookingView } from "./booking";
import { Async, EmptyState, PageHeader, RecordList, Section, SummaryCard, type Column } from "../ui/ui";

const bookingColumns: Column<Booking>[] = [
  { header: "Space", primary: true, cell: (b) => <Link href={`/app/bookings/${b.id}`}>{b.spaceName}</Link> },
  { header: "Bay", cell: (b) => b.bayLabel },
  { header: "When", cell: (b) => formatRange(b.startsAt, b.endsAt) },
  { header: "Status", cell: (b) => <BookingStatusBadge status={b.status} /> },
  { header: "Total", cell: (b) => formatMoney(b.price.totalAmountMinor, b.price.currency) },
];

const FindParking = () => (
  <Link href="/app/discover" className="btn-primary">
    Find parking
  </Link>
);

export function DriverHome({ user }: { user: User }) {
  usePageTitle("Driver overview");
  const bookings = useApi<Booking[]>("/me/bookings");
  return (
    <>
      <PageHeader eyebrow="Driver" title={`Hello, ${user.fullName.split(" ")[0]}.`} actions={<FindParking />} />
      <Async remote={bookings}>
        {(all) => {
          const upcoming = all.filter((b) => isUpcoming(b)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const previous = all.filter((b) => !isUpcoming(b));
          if (!all.length) {
            return (
              <Section title="Your bookings">
                <EmptyState
                  title="No bookings yet"
                  body="Find a verified listing, pick a time and send a request; the owner confirms or declines it. Your requests and bookings will show up here with their time, place, price and status."
                  action={<FindParking />}
                />
              </Section>
            );
          }
          return (
            <>
              <div className="summary-grid">
                <SummaryCard
                  label="Awaiting owner"
                  value={upcoming.filter((b) => b.status === "pending").length}
                  hint="Requests; nothing is held yet"
                />
                <SummaryCard
                  label="Confirmed"
                  value={upcoming.filter((b) => b.status !== "pending").length}
                  hint="Upcoming, held for you"
                />
                <SummaryCard label="Previous" value={previous.length} hint="Completed, cancelled or expired" />
              </div>
              <Section
                title="Next up"
                actions={
                  <Link href="/app/driver/bookings" className="text-link">
                    All bookings
                  </Link>
                }
              >
                {upcoming.length ? (
                  <RecordList rows={upcoming.slice(0, 3)} columns={bookingColumns} caption="Upcoming bookings" />
                ) : (
                  <EmptyState title="Nothing upcoming" body="You have no bookings ahead of you." action={<FindParking />} />
                )}
              </Section>
            </>
          );
        }}
      </Async>
    </>
  );
}

export function DriverBookings() {
  usePageTitle("My bookings");
  const bookings = useApi<Booking[]>("/me/bookings");
  const [view, setView] = useState<BookingView>("all");
  return (
    <>
      <PageHeader title="My bookings" breadcrumbs={[{ href: "/app/driver", label: "Overview" }]} />
      <Section title="Bookings">
        <Async remote={bookings} skeletonLines={4}>
          {(all) => {
            if (!all.length) {
              return <EmptyState title="No bookings yet" body="Your requests and bookings will be listed here." action={<FindParking />} />;
            }
            const shown = filterBookings(all, view);
            return (
              <>
                <BookingViewFilter value={view} onChange={setView} rows={all} />
                {shown.length ? (
                  <RecordList rows={shown} columns={bookingColumns} caption="Your bookings" />
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
