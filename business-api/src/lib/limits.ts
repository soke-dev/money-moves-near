import rateLimit from "express-rate-limit";

/** At most `limit` requests per visitor in the window (15 minutes unless given). Per visitor as worked out in lib/ip - never per proxy. */
export const limited = (limit: number, windowMs = 15 * 60_000) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.clientIp,
    validate: { xForwardedForHeader: false },
    message: { error: "Too many tries. Wait a few minutes and try again.", code: "rate_limited" },
  });
