/**
 * A business's look on checkouts, with the Money Moves defaults for anything
 * it hasn't set. Text on the accent is picked by the checkout for contrast.
 */
import type { Business } from "@prisma/client";
import { imageUrl } from "./images";

export const DEFAULT_BRAND = { surface: "#F5F4F0", accent: "#121210", success: "" };

export function brandOf(b: Pick<Business, "logoId" | "brand">) {
  const saved = (b.brand ?? {}) as Partial<typeof DEFAULT_BRAND>;
  return {
    logo: imageUrl(b.logoId),
    surface: saved.surface ?? DEFAULT_BRAND.surface,
    accent: saved.accent ?? DEFAULT_BRAND.accent,
    success: saved.success ?? DEFAULT_BRAND.success,
  };
}
