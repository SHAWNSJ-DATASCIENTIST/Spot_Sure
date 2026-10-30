import { z } from "zod";

// An owner's weekly opening hours for a parking space. This is configuration
// only: it says when a space may be offered, not that any bay is free (that is
// occupancy) or booked (that is a booking).

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const availabilitySchema = z
  .object({
    timezone: z.string().min(1).max(64).refine(isTimeZone, "Unknown time zone"),
    weekly: z
      .array(
        z
          .object({ day: z.enum(DAYS), opens: time, closes: time })
          .strict()
          .refine((w) => minutes(w.closes) > minutes(w.opens), { path: ["closes"], message: "Must be after opens" }),
      )
      .max(DAYS.length * 4),
  })
  .strict()
  .superRefine((a, ctx) => {
    for (const day of DAYS) {
      const windows = a.weekly
        .map((w, i) => ({ ...w, i }))
        .filter((w) => w.day === day)
        .sort((x, y) => minutes(x.opens) - minutes(y.opens));
      for (let k = 1; k < windows.length; k++) {
        if (minutes(windows[k]!.opens) < minutes(windows[k - 1]!.closes)) {
          ctx.addIssue({ code: "custom", path: ["weekly", windows[k]!.i], message: "Overlaps another window on the same day" });
        }
      }
    }
  });

export type Availability = z.infer<typeof availabilitySchema>;
