/*
 * Port of GuestId.kt's rule. YouTube asks a brand-new guest to "sign in to confirm you're not a bot"
 * before some videos, so YouTube's cookies (the guest ID) are kept between sessions, and a new guest
 * starts every GUEST_MAX_DAYS days, or on Clean Start. Sign-in cookies are never kept.
 */
export const GUEST_MAX_DAYS = 10;
const DAY_MS = 86400000;

/** True when the guest must be replaced: none yet, too old, or the clock went back. */
export function guestExpired(startedAt, now) {
  const age = now - startedAt;
  return !(startedAt > 0) || age < 0 || age >= GUEST_MAX_DAYS * DAY_MS;
}

/** Day of the guest's life, from 1, for the popup. */
export function guestDay(startedAt, now) {
  return guestExpired(startedAt, now) ? 0 : Math.floor((now - startedAt) / DAY_MS) + 1;
}

/** Cookies that only exist when someone is signed in to Google; a guest never has them. */
export const SIGNED_IN_COOKIES = new Set([
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'SIDCC', 'LOGIN_INFO',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID',
  '__Secure-1PSIDTS', '__Secure-3PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
]);

export function isYouTubeSignInCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  return (domain === 'youtube.com' || domain.endsWith('.youtube.com')) && SIGNED_IN_COOKIES.has(cookie.name);
}
