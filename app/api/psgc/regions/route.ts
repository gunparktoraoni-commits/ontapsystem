/**
 * GET /api/psgc/regions
 * 
 * Fetch all Philippine regions from PSGC Cloud API
 * 
 * Query Parameters:
 * - None
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "data": [
 *     { "code": "0100000000", "name": "Region I (Ilocos Region)" },
 *     { "code": "0200000000", "name": "Region II (Cagayan Valley)" },
 *     ...
 *   ]
 * }
 * 
 * Error Response (500 Server Error):
 * {
 *   "success": false,
 *   "error": "Failed to fetch regions",
 *   "code": "REGIONS_FETCH_FAILED",
 *   "tag": "[PSGC_REGIONS_API]"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchRegions, PSGCCloudError } from '@/lib/services/psgc-cloud-api';

export async function GET(request: NextRequest) {
  try {
    // Validate request
    if (request.method !== 'GET') {
      return NextResponse.json(
        {
          success: false,
          error: 'Method not allowed',
          code: 'METHOD_NOT_ALLOWED',
          tag: '[PSGC_REGIONS_API]',
        },
        { status: 405 }
      );
    }

    // Fetch regions from PSGC Cloud
    const regions = await fetchRegions();

    return NextResponse.json(
      {
        success: true,
        data: regions,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        },
      }
    );
  } catch (error) {
    // Handle PSGC-specific errors
    if (error instanceof PSGCCloudError) {
      console.error(`[${error.tag}] ${error.code}: ${error.message}`);

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          tag: error.tag,
        },
        { status: error.status }
      );
    }

    // Handle unexpected errors
    console.error('[PSGC_REGIONS_API] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
        tag: '[PSGC_REGIONS_API]',
      },
      { status: 500 }
    );
  }
}
