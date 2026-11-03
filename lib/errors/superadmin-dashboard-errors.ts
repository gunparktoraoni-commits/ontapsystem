// ──────────────────────────────────────────────────────────────
// Superadmin Dashboard Error Codes
// ──────────────────────────────────────────────────────────────
// Error codes for superadmin dashboard API endpoints
// Range: 28000-28599
// 
// Format: DASHBOARD_XXXXX where XXXXX is the error number
// ──────────────────────────────────────────────────────────────

export enum SuperAdminDashboardErrorCode {
  // Authorization errors (28000-28099)
  UNAUTHORIZED_ACCESS = 'DASHBOARD_28000',
  SUPERADMIN_REQUIRED = 'DASHBOARD_28001',
  INVALID_SESSION = 'DASHBOARD_28002',
  SESSION_EXPIRED = 'DASHBOARD_28003',
  INSUFFICIENT_PERMISSIONS = 'DASHBOARD_28004',

  // Date/Filter errors (28100-28199)
  INVALID_DATE_RANGE = 'DASHBOARD_28100',
  INVALID_FILTER_TYPE = 'DASHBOARD_28101',
  DATE_RANGE_TOO_LARGE = 'DASHBOARD_28102',
  INVALID_TIMEZONE = 'DASHBOARD_28103',
  START_DATE_AFTER_END_DATE = 'DASHBOARD_28104',
  INVALID_DATE_FORMAT = 'DASHBOARD_28105',

  // Data errors (28200-28299)
  DATA_NOT_FOUND = 'DASHBOARD_28200',
  METRIC_NOT_AVAILABLE = 'DASHBOARD_28201',
  USER_NOT_FOUND = 'DASHBOARD_28202',
  COMPANY_NOT_FOUND = 'DASHBOARD_28203',
  ORDER_NOT_FOUND = 'DASHBOARD_28204',
  STAFF_NOT_FOUND = 'DASHBOARD_28205',
  SUBSCRIPTION_NOT_FOUND = 'DASHBOARD_28206',
  INVALID_USER_STATUS = 'DASHBOARD_28207',
  INVALID_ORDER_STATUS = 'DASHBOARD_28208',

  // Geolocation errors (28300-28399)
  GEOLOCATION_FETCH_FAILED = 'DASHBOARD_28300',
  IP_GEOLOCATION_UNAVAILABLE = 'DASHBOARD_28301',
  INVALID_IP_ADDRESS = 'DASHBOARD_28302',
  GEOLOCATION_SERVICE_LIMIT_EXCEEDED = 'DASHBOARD_28303',
  GEOLOCATION_TIMEOUT = 'DASHBOARD_28304',

  // Batch errors (28400-28499)
  INVALID_PAGINATION = 'DASHBOARD_28400',
  PAGE_LIMIT_EXCEEDED = 'DASHBOARD_28401',
  INVALID_SORT_FIELD = 'DASHBOARD_28402',
  INVALID_SORT_DIRECTION = 'DASHBOARD_28403',
  BATCH_SIZE_TOO_LARGE = 'DASHBOARD_28404',

  // Rate limiting (28500-28599)
  RATE_LIMIT_EXCEEDED = 'DASHBOARD_28500',
  QUOTA_EXCEEDED = 'DASHBOARD_28501',
  TEMPORARY_BLOCK = 'DASHBOARD_28502',
  SUSPICIOUS_ACTIVITY = 'DASHBOARD_28503',

  // System errors (28600-28699)
  DATABASE_ERROR = 'DASHBOARD_28600',
  EXTERNAL_SERVICE_ERROR = 'DASHBOARD_28601',
  CACHE_ERROR = 'DASHBOARD_28602',
  REPORT_GENERATION_FAILED = 'DASHBOARD_28603',
  EXPORT_FAILED = 'DASHBOARD_28604'
}

export interface SuperAdminDashboardError {
  code: SuperAdminDashboardErrorCode;
  message: string;
  details?: any;
  requestId?: string;
  timestamp: string;
}

export function createSuperAdminError(
  code: SuperAdminDashboardErrorCode,
  message?: string,
  details?: any,
  requestId?: string
): SuperAdminDashboardError {
  const errorMessages: Record<SuperAdminDashboardErrorCode, string> = {
    [SuperAdminDashboardErrorCode.UNAUTHORIZED_ACCESS]: 'Unauthorized access to dashboard',
    [SuperAdminDashboardErrorCode.SUPERADMIN_REQUIRED]: 'Superadmin privileges required',
    [SuperAdminDashboardErrorCode.INVALID_SESSION]: 'Invalid session provided',
    [SuperAdminDashboardErrorCode.SESSION_EXPIRED]: 'Session has expired',
    [SuperAdminDashboardErrorCode.INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions for this action',
    
    [SuperAdminDashboardErrorCode.INVALID_DATE_RANGE]: 'Invalid date range provided',
    [SuperAdminDashboardErrorCode.INVALID_FILTER_TYPE]: 'Invalid filter type specified',
    [SuperAdminDashboardErrorCode.DATE_RANGE_TOO_LARGE]: 'Date range exceeds maximum allowed period',
    [SuperAdminDashboardErrorCode.INVALID_TIMEZONE]: 'Invalid timezone specified',
    [SuperAdminDashboardErrorCode.START_DATE_AFTER_END_DATE]: 'Start date cannot be after end date',
    [SuperAdminDashboardErrorCode.INVALID_DATE_FORMAT]: 'Invalid date format provided',
    
    [SuperAdminDashboardErrorCode.DATA_NOT_FOUND]: 'Requested data not found',
    [SuperAdminDashboardErrorCode.METRIC_NOT_AVAILABLE]: 'Requested metric is not available',
    [SuperAdminDashboardErrorCode.USER_NOT_FOUND]: 'User not found',
    [SuperAdminDashboardErrorCode.COMPANY_NOT_FOUND]: 'Company not found',
    [SuperAdminDashboardErrorCode.ORDER_NOT_FOUND]: 'Order not found',
    [SuperAdminDashboardErrorCode.STAFF_NOT_FOUND]: 'Staff member not found',
    [SuperAdminDashboardErrorCode.SUBSCRIPTION_NOT_FOUND]: 'Subscription not found',
    [SuperAdminDashboardErrorCode.INVALID_USER_STATUS]: 'Invalid user status specified',
    [SuperAdminDashboardErrorCode.INVALID_ORDER_STATUS]: 'Invalid order status specified',
    
    [SuperAdminDashboardErrorCode.GEOLOCATION_FETCH_FAILED]: 'Failed to fetch geolocation data',
    [SuperAdminDashboardErrorCode.IP_GEOLOCATION_UNAVAILABLE]: 'IP geolocation service unavailable',
    [SuperAdminDashboardErrorCode.INVALID_IP_ADDRESS]: 'Invalid IP address provided',
    [SuperAdminDashboardErrorCode.GEOLOCATION_SERVICE_LIMIT_EXCEEDED]: 'Geolocation service rate limit exceeded',
    [SuperAdminDashboardErrorCode.GEOLOCATION_TIMEOUT]: 'Geolocation service request timeout',
    
    [SuperAdminDashboardErrorCode.INVALID_PAGINATION]: 'Invalid pagination parameters',
    [SuperAdminDashboardErrorCode.PAGE_LIMIT_EXCEEDED]: 'Page limit exceeded',
    [SuperAdminDashboardErrorCode.INVALID_SORT_FIELD]: 'Invalid sort field specified',
    [SuperAdminDashboardErrorCode.INVALID_SORT_DIRECTION]: 'Invalid sort direction specified',
    [SuperAdminDashboardErrorCode.BATCH_SIZE_TOO_LARGE]: 'Batch size exceeds maximum allowed',
    
    [SuperAdminDashboardErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded',
    [SuperAdminDashboardErrorCode.QUOTA_EXCEEDED]: 'Quota exceeded',
    [SuperAdminDashboardErrorCode.TEMPORARY_BLOCK]: 'Temporary block due to suspicious activity',
    [SuperAdminDashboardErrorCode.SUSPICIOUS_ACTIVITY]: 'Suspicious activity detected',
    
    [SuperAdminDashboardErrorCode.DATABASE_ERROR]: 'Database operation failed',
    [SuperAdminDashboardErrorCode.EXTERNAL_SERVICE_ERROR]: 'External service error',
    [SuperAdminDashboardErrorCode.CACHE_ERROR]: 'Cache operation failed',
    [SuperAdminDashboardErrorCode.REPORT_GENERATION_FAILED]: 'Report generation failed',
    [SuperAdminDashboardErrorCode.EXPORT_FAILED]: 'Data export failed'
  };

  return {
    code,
    message: message || errorMessages[code] || 'Unknown error occurred',
    details,
    requestId,
    timestamp: new Date().toISOString()
  };
}

export function isSuperAdminDashboardError(error: any): error is SuperAdminDashboardError {
  return error && typeof error === 'object' && 'code' in error && 
         Object.values(SuperAdminDashboardErrorCode).includes(error.code);
}

export function getErrorCategory(code: SuperAdminDashboardErrorCode): string {
  const codeNum = parseInt(code.split('_')[1]);
  
  if (codeNum >= 28000 && codeNum <= 28099) return 'authorization';
  if (codeNum >= 28100 && codeNum <= 28199) return 'validation';
  if (codeNum >= 28200 && codeNum <= 28299) return 'data';
  if (codeNum >= 28300 && codeNum <= 28399) return 'geolocation';
  if (codeNum >= 28400 && codeNum <= 28499) return 'pagination';
  if (codeNum >= 28500 && codeNum <= 28599) return 'rate_limit';
  if (codeNum >= 28600 && codeNum <= 28699) return 'system';
  
  return 'unknown';
}

export function isRetryableError(code: SuperAdminDashboardErrorCode): boolean {
  const retryableCodes = [
    SuperAdminDashboardErrorCode.GEOLOCATION_TIMEOUT,
    SuperAdminDashboardErrorCode.EXTERNAL_SERVICE_ERROR,
    SuperAdminDashboardErrorCode.CACHE_ERROR,
    SuperAdminDashboardErrorCode.DATABASE_ERROR
  ];
  
  return retryableCodes.includes(code);
}
