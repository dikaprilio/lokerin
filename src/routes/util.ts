import { z } from "zod";
import { HttpError } from "../auth/session.js";

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "body").join(", ");
    throw new HttpError(400, "input_tidak_valid", `Data tidak valid: ${fields}`);
  }
  return result.data;
}

export const idParam = z.object({ id: z.string().uuid() });
