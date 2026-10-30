import { z } from "zod";
import { ValidationError } from "./errors.js";

/** A whole-minute ISO 8601 instant with an explicit zone (Z or ±hh:mm). */
export const isoInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:00(\.000)?)?(Z|[+-]\d{2}:\d{2})$/, "Use an ISO 8601 time with a time zone")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a real date");

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues);
  return result.data;
}
