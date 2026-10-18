/** Where the developer docs live: their own site, docs.usemoneymoves.xyz - or the local copy while developing. */
export const DOCS_URL: string = import.meta.env.VITE_DOCS_URL ?? (import.meta.env.DEV ? 'http://localhost:5176' : 'https://docs.usemoneymoves.xyz')

/** The API's address. The key, not the URL, decides test or live. */
export const API_BASE = 'https://api.usemoneymoves.xyz/v1'

/** Where businesses write to us - a person reads it. */
export const SUPPORT_EMAIL = 'support@usemoneymoves.xyz'

/** The Money Moves website - where people get the app. */
export const WEBSITE = 'https://usemoneymoves.xyz'

/** Where to get the Money Moves app. */
export const APP_STORE = 'https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053'
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app'
