import type { ErrorResponse } from "@j-customer-auth-db/contracts";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorResponse["error"],
    message: string,
  ) {
    super(message);
  }
}
export const invalid = () =>
  new ApiError(400, "invalid_request", "Invalid request.");
export const unavailable = () =>
  new ApiError(503, "unavailable", "Service unavailable.");
export const missing = () =>
  new ApiError(404, "not_found", "Resource not found.");
export const forbidden = () =>
  new ApiError(403, "forbidden", "Permission denied.");
export const unauthenticated = () =>
  new ApiError(401, "unauthenticated", "Valid authentication required.");
export const wrongCredentials = () =>
  new ApiError(401, "invalid_credentials", "Invalid login credentials.");
export const limited = () =>
  new ApiError(429, "rate_limited", "Try again later.");
