/**
 * A referral code from another business's link, kept in this browser from the
 * moment the link is opened until a business is made with it - so signing up
 * through Google, or coming back later, still counts.
 */
const KEY = 'mmb_ref'

export function keepReferral(code: string | null | undefined) {
  const clean = code?.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16)
  if (!clean) return
  try {
    localStorage.setItem(KEY, clean)
  } catch {
    /* private window or blocked storage: the field on the form still carries it */
  }
}

export function referralCode(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetReferral() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to forget */
  }
}

/** An invite link's token, from ?invite= on sign-in and sign-up. */
export const inviteFrom = (params: URLSearchParams) => {
  const t = params.get('invite')
  return t && /^[A-Za-z0-9_-]{20,64}$/.test(t) ? t : null
}
