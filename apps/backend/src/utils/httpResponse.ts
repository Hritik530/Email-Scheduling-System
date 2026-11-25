import { Response } from 'express';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): Response<ApiSuccessResponse<T>> {
  const payload: ApiSuccessResponse<T> = meta
    ? { success: true, data, meta }
    : { success: true, data };
  return res.status(statusCode).json(payload);
}
