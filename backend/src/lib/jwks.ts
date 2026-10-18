// This file is deprecated — Web3Auth integration was removed.
// Kept as a placeholder to avoid import errors in case any dead references remain.
export const jwksJson = { keys: [] };
export function signWeb3AuthToken(_userId: string): string {
  throw new Error("Web3Auth is no longer used");
}
