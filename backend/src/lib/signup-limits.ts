/**
 * How many accounts one handset may create.
 *
 * Here rather than in the auth route, for the same reason the transfer limits
 * are not in the transactions route: the admin console reports against this
 * number, and a route importing another route is a cycle waiting to happen -
 * the kind that resolves to undefined at whichever end loads first, which for
 * a limit means no limit at all.
 *
 * Three, so the fourth is refused. Generous on purpose: a shared phone in a
 * household is ordinary here, and a shop demonstrating the app will make more
 * than one account. Below three the rule would cost real signups; above it,
 * somebody farming accounts barely notices.
 */
export const MAX_ACCOUNTS_PER_DEVICE = 3;
