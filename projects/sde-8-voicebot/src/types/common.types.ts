export interface ApiErrorEnvelope {
  code: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: ApiErrorEnvelope;
  timestamp: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}
