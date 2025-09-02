export interface ValidationError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ValidationWarning {
  code: string;
  message: string;
  details?: unknown;
}

export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationReport {
  timestamp: Date;
  overallSuccess: boolean;
  configuration: ValidationResult;
  balance: ValidationResult;
  connectivity: ValidationResult;
  summary: {
    totalErrors: number;
    totalWarnings: number;
    criticalErrors: string[];
  };
}
