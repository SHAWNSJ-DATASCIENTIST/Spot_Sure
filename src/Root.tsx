import { useEffect } from "react";
import { App } from "./App";
import type { User } from "./app/api";
import { AuthProvider, useAuth } from "./app/auth";
import { navigate, useLocation } from "./app/router";
import { canAccess, homeFor, matchAppRoute, type AppRoute } from "./app/routes";
import { BookingDetail } from "./dashboards/booking";
import { Discover, DiscoverListing } from "./dashboards/discover";
import { DriverBookings, DriverHome } from "./dashboards/driver";
import { OwnerListingDetail, OwnerListingNew, OwnerListings, StaffListingReview } from "./dashboards/listings";
import { OwnerBookings, OwnerHome } from "./dashboards/owner";
import { Notifications } from "./dashboards/notifications";
import { Profile } from "./dashboards/profile";
import { SocietyDetail, SocietyHome } from "./dashboards/society";
import { usePageTitle } from "./pages/Field";
import { Register } from "./pages/Register";
import { SignIn } from "./pages/SignIn";
import { AppShell } from "./shell/AppShell";
import { AccessDenied, EmptyState, PageHeader } from "./ui/ui";

const DENIED: Record<string, string> = {
  driver: "This dashboard is for driver accounts.",
  owner: "This dashboard is for parking owner accounts.",
  society: "This area is for administrators of a society. Access is assigned by the SpotSure team.",
  staff: "This area is for SpotSure staff.",
};

function Denied({ message, homeHref }: { message: string; homeHref: string }) {
  usePageTitle("Access denied");
  return (
    <>
      <PageHeader title="Access denied" />
      <AccessDenied message={message} homeHref={homeHref} />
    </>
  );
}

function NotFound() {
  usePageTitle("Page not found");
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState title="There's nothing at this address" body="Use the navigation to find your way back." />
    </>
  );
}

function Page({ route, user }: { route: AppRoute; user: User }) {
  const home = homeFor(user);
  // Navigation aid only: the API independently refuses data the user may not see.
  if (!canAccess(route.area, user)) {
    return <Denied message={DENIED[route.area] ?? "You can't open this page."} homeHref={home} />;
  }
  switch (route.name) {
    case "driver":
      return <DriverHome user={user} />;
    case "driverBookings":
      return <DriverBookings />;
    case "booking":
      return <BookingDetail id={route.id!} user={user} />;
    case "discover":
      return <Discover />;
    case "discoverListing":
      return <DiscoverListing id={route.id!} user={user} />;
    case "staffReview":
      return <StaffListingReview />;
    case "owner":
      return <OwnerHome />;
    case "ownerSpaces":
      return <OwnerListings />;
    case "ownerSpaceNew":
      return <OwnerListingNew />;
    case "ownerSpace":
      return <OwnerListingDetail id={route.id!} />;
    case "ownerBookings":
      return <OwnerBookings />;
    case "society":
      return <SocietyHome />;
    case "societyDetail":
      return <SocietyDetail id={route.id!} homeHref={home} />;
    case "profile":
      return <Profile user={user} />;
    case "notifications":
      return <Notifications />;
    default:
      return <NotFound />;
  }
}

/** Restores the session from the API, then guards and lays out signed-in pages. */
function SignedInApp({ route }: { route: AppRoute }) {
  const { state } = useAuth();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (state.status === "signed-out") {
      const next = pathname + (search.toString() ? `?${search}` : "");
      navigate(`/sign-in?next=${encodeURIComponent(next)}&reason=${state.reason ?? "required"}`, { replace: true });
    } else if (state.status === "signed-in" && route.name === "home") {
      navigate(homeFor(state.user), { replace: true });
    }
  }, [state, route.name, pathname, search]);

  if (state.status !== "signed-in" || route.name === "home") {
    return (
      <p className="app-loading" role="status">
        Loading…
      </p>
    );
  }
  return (
    <AppShell user={state.user} route={route.name}>
      <Page route={route} user={state.user} />
    </AppShell>
  );
}

function Routes() {
  const { pathname } = useLocation();
  const appRoute = matchAppRoute(pathname);
  if (appRoute) return <SignedInApp route={appRoute} />;
  switch (pathname.replace(/\/+$/, "") || "/") {
    case "/sign-in":
      return <SignIn />;
    case "/register":
      return <Register />;
    default:
      return <App />;
  }
}

export function Root() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}
