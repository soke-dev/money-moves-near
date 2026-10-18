import { Request, Response, NextFunction } from "express";

/**
 * Global error handler. Catches all unhandled errors.
 * Never leaks stack traces or internal details to the client.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("Unhandled error:", err);

  // Never expose internal error details in production
  const isDev = process.env.NODE_ENV === "development";

  res.status(500).json({
    error: "Internal server error",
    ...(isDev && { message: err.message }),
  });
}
