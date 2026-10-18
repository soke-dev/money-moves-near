import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

/**
 * Validate request body against a Zod schema.
 * Returns 400 with structured errors if validation fails.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        const summary = errors.map((e) => e.field ? `${e.field}: ${e.message}` : e.message).join("; ");
        console.error(`[VALIDATE] ${req.method} ${req.path} — ${summary}`);
        res.status(400).json({ error: summary || "Validation failed", details: errors });
      } else {
        next(err);
      }
    }
  };
}
