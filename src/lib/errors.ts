export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new ServiceError(404, "not_found", what);
export const forbidden = (msg = "You do not have permission to do that.") => new ServiceError(403, "forbidden", msg);
export const conflict = (code: string, msg: string, details?: unknown) => new ServiceError(409, code, msg, details);
export const invalid = (msg: string, details?: unknown) => new ServiceError(422, "invalid", msg, details);
