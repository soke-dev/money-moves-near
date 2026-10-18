import type { Request } from "express";
import type { ZodType } from "zod";

/** An error meant for the person - its message is safe to show as it is. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** The request body, checked. The first problem becomes a plain 400. */
export function body<T>(schema: ZodType<T>, req: Request): T {
  const r = schema.safeParse(req.body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "That request isn't quite right.", "invalid_request");
  return r.data;
}
