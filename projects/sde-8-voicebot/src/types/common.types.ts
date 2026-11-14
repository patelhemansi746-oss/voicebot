export interface ApiErrorEnvelope {
  code: string;
  message_safe_for_user: string;
  retryable: boolean;
  correlation_id: string;
  details_redacted?: unknown;
  details?: unknown; // Retained for backwards compatibility
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
      requestId?: string;
      correlationId?: string;
    }
  }
}
