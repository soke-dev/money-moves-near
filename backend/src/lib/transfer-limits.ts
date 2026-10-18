/**
 * How often one account may make us pay for a transfer.
 *
 * Here rather than beside the route that enforces it, because the admin radar
 * reports against the same number and a route importing another route is a
 * cycle waiting to happen - the kind that resolves to undefined at whichever
 * end loads first, which for a limit means no limit.
 */

/**
 * Solana withdrawals and username transfers, counted together, per day.
 *
 * Together because to the gas wallet they are one thing: a sponsored transfer
 * to an address the sender chose. Counting them apart would have meant twenty.
 *
 * Solana has a ceiling of its own because it is the chain where a sponsored
 * transfer can cost rent rather than a fraction of a cent. Opening a token
 * account for a recipient costs about 0.0015 SOL, and that rent is refundable
 * to whoever owns the account - so an address could take a withdrawal, close
 * the account we opened, pocket the rent and come back. One account did that
 * fifty-six times in an afternoon and emptied the wallet.
 */
export const SOL_TRANSFERS_PER_DAY = 5;

/** Sponsored withdrawals on any chain we pay gas for. Arc is not one. */
export const SPONSORED_PER_HOUR = 10;
export const SPONSORED_PER_DAY = 30;
