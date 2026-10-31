export interface CveSearchParams {
  product?: string;
  severity?: string;
  days?: number;
  limit?: number;
}

export interface CodeCheckBody {
  code: string;
  language?: string;
}

export interface HeaderCheckBody {
  headers: Record<string, string>;
}

export class ContrastApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ContrastApiError";
    this.status = status;
  }
}
