export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unprocessable"
  | "integration_disabled"
  | "internal_error";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "validation_error", message, details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to perform this action") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, "unprocessable", message, details);
export const rateLimited = () => new AppError(429, "rate_limited", "Too many requests, please try again shortly");
