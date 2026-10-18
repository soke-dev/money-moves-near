import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

/**
 * Only a Dynamic wallet may sign.
 *
 * The 12-word wallet is no longer a supported way to hold money here, so every
 * path that asks a device for a signature refuses an account still on one. It
 * sits in front of the prepare endpoints rather than the submit ones on
 * purpose: refusing after somebody has signed wastes the signature and reads
 * as a failure of theirs rather than a wallet we stopped supporting.
 *
 * Exporting is deliberately NOT gated by this. Stopping an account from
 * spending is a product decision; stopping it from getting its own recovery
 * phrase out would be taking the money, and those are different things. A
 * mnemonic holder can still read their twelve words and reach their funds in
 * any wallet that accepts them.
 *
 * Null is refused too, and that is the whole point of this being useful.
 *
 * The flag is written by the app, not at signup, so an account that has never
 * run a recent build has no flag at all - and every 12-word wallet predating
 * Dynamic sits in exactly that state. Allowing null meant the guard refused
 * almost nobody.
 *
 * It is safe to refuse because the app sets EMBEDDED on every launch for
 * anyone holding an embedded key or signed into Dynamic. An email account with
 * a stale record is unblocked by the very act of opening the app, so the worst
 * case is one refusal and a retry - which is why null gets its own message
 * rather than being told to upgrade a wallet it does not have.
 */
export async function requireDynamicWallet(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletType: true },
    });

    if (user?.walletType === "MNEMONIC") {
      res.status(403).json({
        error:
          "This account is still on the old 12-word wallet, which can no longer send. " +
          "Move to an email wallet to keep using Money Moves — your recovery phrase is " +
          "still available under Export, so nothing is locked away.",
        code: "WALLET_UPGRADE_REQUIRED",
      });
      return;
    }

    if (!user?.walletType) {
      /**
       * No flag at all. Either a 12-word wallet from before the flag existed,
       * or an email wallet whose record has not caught up - and from here the
       * two look identical, so it says what to do rather than guessing which.
       */
      console.warn(`[WALLET] blocked signing for user ${req.user?.userId} — no wallet type on record`);
      res.status(403).json({
        error:
          "We could not confirm this account's wallet. Close the app and open it again — " +
          "if it still will not send, the account is on the old 12-word wallet and needs " +
          "moving to an email wallet.",
        code: "WALLET_TYPE_UNKNOWN",
      });
      return;
    }

    next();
  } catch (err) {
    // A database hiccup must not become a refusal to move money.
    console.error("[WALLET] kind check failed:", err);
    next();
  }
}
