import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireAuth } from "../auth/plugin.js";
import { assertRole, canViewBooking, ForbiddenError } from "../auth/policies.js";
import { bookingAction, quoteTotalMinor, requestProblems } from "../domain/booking.js";
import { checkoutProblem } from "../domain/payment.js";
import { bookability, isPubliclyVisible } from "../domain/listing.js";
import { AppError, NotFoundError } from "../http/errors.js";
import { isoInstant, parse } from "../http/validate.js";
import {
  confirmBooking,
  createBookingRequest,
  getBookingRow,
  listBookingsForOwner,
  listBookingsForUser,
  presentBooking,
  endBooking,
  settlePastBookings,
} from "../repositories/bookings.js";
import { factsOf, getListingDetail } from "../repositories/listings.js";
import { listSocietiesForAdmin, presentSociety } from "../repositories/societies.js";
import { administeredSocietyIds, presentUser, updateUser } from "../repositories/users.js";

const profilePatch = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
      .nullable()
      .optional(),
  })
  .strict();

const idParams = z.object({ id: z.uuid() });

// Everything here is scoped to the signed-in user by the session, never by an
// id taken from the request.
export async function accountRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const db = deps.db.db;

  app.patch("/users/me", async (req) => {
    const auth = requireAuth(req);
    const body = parse(profilePatch, req.body);
    const user = await updateUser(db, auth.id, { displayName: body.fullName, phone: body.phone });
    return { data: presentUser(user, { administeredSocietyIds: await administeredSocietyIds(db, auth.id) }) };
  });

  app.get("/me/bookings", async (req) => {
    const auth = requireAuth(req);
    return { data: (await listBookingsForUser(db, auth.id)).map((r) => presentBooking(r, "booker")) };
  });

  // Booking activity across every space the signed-in user owns. Empty for
  // accounts that own nothing, so no role check is needed to stay safe.
  app.get("/me/space-bookings", async (req) => {
    const auth = requireAuth(req);
    return { data: (await listBookingsForOwner(db, auth.id)).map((r) => presentBooking(r, "owner")) };
  });

  // Societies this user is explicitly assigned to administer. Platform admins
  // get no extra rows here: platform administration is a separate surface.
  app.get("/me/societies", async (req) => {
    const auth = requireAuth(req);
    return { data: (await listSocietiesForAdmin(db, auth.id)).map(presentSociety) };
  });

  /** Loads a booking the signed-in user may see; one 404 for missing and not-yours. */
  async function loadVisible(req: Parameters<typeof requireAuth>[0], id: string) {
    const auth = requireAuth(req);
    await settlePastBookings(db);
    const found = await getBookingRow(db, id);
    if (!found || !canViewBooking(auth, found.booking, found.spaceOwnerId)) throw new NotFoundError("Booking");
    return { auth, found, view: found.booking.userId === auth.id ? ("booker" as const) : ("owner" as const) };
  }

  app.get("/bookings/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const { found, view } = await loadVisible(req, id);
    return { data: presentBooking(found, view) };
  });

  // A driver asks for a slot. Identity, price and status all come from the
  // server; the body carries only which listing and when.
  app.post("/bookings", { config: { rateLimit: { max: deps.env.BOOKING_RATE_LIMIT_MAX, timeWindow: 60 * 60_000 } } }, async (req, reply) => {
    const auth = requireAuth(req);
    assertRole(auth, "driver");
    const body = parse(bookingRequest, req.body);
    const detail = await getListingDetail(db, body.spaceId);
    const facts = detail ? factsOf(detail) : null;
    if (!detail || !facts || !isPubliclyVisible(facts)) throw new NotFoundError("Parking space");
    const { bookable, reasons } = bookability(facts);
    if (!bookable) throw new AppError(409, "not_bookable", `This space can't be booked right now: ${reasons.join(", ")}`);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    const problems = requestProblems(startsAt, endsAt, {
      timezone: detail.space.timezone,
      weekly: detail.hours,
      minBookingMinutes: detail.space.minBookingMinutes,
      maxBookingMinutes: detail.space.maxBookingMinutes,
    });
    if (problems.length) {
      throw new AppError(400, "invalid_time", problems[0]!, problems.map((message) => ({ path: "startsAt", message })));
    }
    const id = await createBookingRequest(db, {
      userId: auth.id,
      spaceId: detail.space.id,
      startsAt,
      endsAt,
      hourlyPriceMinor: detail.space.hourlyPriceMinor,
      totalPriceMinor: quoteTotalMinor(detail.space.hourlyPriceMinor, startsAt, endsAt, detail.space.dailyPriceMinor),
    });
    return reply.status(201).send({ data: presentBooking((await getBookingRow(db, id))!, "booker") });
  });

  for (const action of ["confirm", "decline", "cancel"] as const) {
    app.post(`/bookings/:id/${action}`, async (req) => {
      const { id } = parse(idParams, req.params);
      const { auth, found } = await loadVisible(req, id);
      const party = found.spaceOwnerId === auth.id ? "owner" : "driver";
      if (action !== "cancel" && party !== "owner") throw new ForbiddenError("Only the space owner can respond to a request");
      const decision = bookingAction(found.booking.status, action, party);
      if (!decision.ok) throw new AppError(409, "invalid_transition", decision.reason);
      if (found.booking.startsAt.getTime() <= Date.now()) {
        throw new AppError(409, "already_started", "This booking has already started and can't be changed");
      }
      if (action === "confirm") {
        // A listing that has since been unpublished, archived, sent back to
        // review (e.g. moved) or whose owner was suspended can't take on new
        // bookings; declining or cancelling stays possible.
        const detail = await getListingDetail(db, found.booking.spaceId);
        const { bookable, reasons } = detail ? bookability(factsOf(detail)) : { bookable: false, reasons: ["Listing not found"] };
        if (!bookable) throw new AppError(409, "not_bookable", `This space can't take bookings right now: ${reasons.join(", ")}`);
        await confirmBooking(db, id);
      }
      else await endBooking(db, id, ["pending", ...(action === "cancel" ? (["confirmed"] as const) : [])], party, action);
      const view = found.booking.userId === auth.id ? "booker" : "owner";
      return { data: presentBooking((await getBookingRow(db, id))!, view) };
    });
  }

  // Starts paying for a confirmed booking. No provider is integrated, so this
  // always ends in 503 payments_disabled and writes nothing. The booker-only
  // and state checks still run first so the contract is fixed before a
  // provider exists; the amount would come from amountDueMinor(booking).
  app.post("/bookings/:id/checkout", async (req) => {
    const { id } = parse(idParams, req.params);
    const { found, view } = await loadVisible(req, id);
    if (view !== "booker") throw new ForbiddenError("Only the driver who made the booking can pay for it");
    const problem = checkoutProblem(deps.env.PAYMENTS_PROVIDER, found.booking.status, found.booking.paymentStatus);
    if (problem) throw new AppError(problem.status, problem.code, problem.message);
    // Unreachable while PAYMENTS_PROVIDER is "none".
    throw new AppError(503, "payments_disabled", "SpotSure doesn't take payments yet. Nothing has been charged.");
  });
}


const bookingRequest = z.object({ spaceId: z.uuid(), startsAt: isoInstant, endsAt: isoInstant }).strict();
