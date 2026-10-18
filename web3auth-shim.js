// React Native has no browser. Some Web3Auth web deps (e.g.
// @chaitanyapotti/register-service-worker) call window.addEventListener at
// import time, which crashes on RN where window lacks it. Stub the missing
// browser APIs as no-ops so those imports load harmlessly. Must run BEFORE the
// Web3Auth SDK is imported (see index.js import order).
if (typeof global.window === "undefined") {
  // eslint-disable-next-line no-global-assign
  global.window = global;
}
if (typeof global.window.addEventListener !== "function") {
  global.window.addEventListener = () => {};
}
if (typeof global.window.removeEventListener !== "function") {
  global.window.removeEventListener = () => {};
}
if (typeof global.window.dispatchEvent !== "function") {
  global.window.dispatchEvent = () => false;
}
