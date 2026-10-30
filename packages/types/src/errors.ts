export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: { path: string; message: string }[];
  };
}
