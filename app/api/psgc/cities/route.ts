/**
 * GET /api/psgc/cities
 * 
 * Fetch cities/municipalities for a specific region from PSGC Cloud API
 * 
 * Query Parameters:
 * - regionCode (required): PSGC region code (e.g., "0100000000")
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "code": "0102812000",
 *       "name": "City of Laoag",
 *       "type": "City",
 *       "district": "1st",
 *       "zip_code": "2900"
 *     },
 *     ...
 *   ]
 * }
 * 
 * Error Response (400 Bad Request):
 * {
 *   "success": false,
 *   "error": "Region code is required",
 *   "code": "MISSING_REGION_CODE",
 *   "tag": "[PSGC_CITIES_API]"
 * }
 * 
 * Error Response (500 Server Error):
 * {
 *   "success": false,
 *   "error": "Failed to fetch cities",
 *   "code": "CITIES_FETCH_FAILED",
 *   "tag": "[PSGC_CITIES_API]"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchCitiesByRegion, PSGCCloudError } from '@/lib/services/psgc-cloud-api';

export async function GET(request: NextRequest) {
  try {
    // Validate request method
    if (request.method !== 'GET') {
      return NextResponse.json(
        {
          success: false,
          error: 'Method not allowed',
          code: 'METHOD_NOT_ALLOWED',
          tag: '[PSGC_CITIES_API]',
        },
        { status: 405 }
      );
    }

    // Extract and validate query parameters
    const { searchParams } = new URL(request.url);
    const regionCode = searchParams.get('regionCode');

    if (!regionCode) {
      return NextResponse.json(
        {
          success: false,
          error: 'Region code is required',
          code: 'MISSING_REGION_CODE',
          tag: '[PSGC_CITIES_API]',
        },
        { status: 400 }
      );
    }

    // Validate region code format (should be 10 digits)
    if (!/^\d{10}$/.test(regionCode)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid region code format (expected 10 digits)',
          code: 'INVALID_REGION_CODE_FORMAT',
          tag: '[PSGC_CITIES_API]',
        },
        { status: 400 }
      );
    }

    // Fetch cities for region
    const cities = await fetchCitiesByRegion(regionCode);

    return NextResponse.json(
      {
        success: true,
        data: cities,
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
    console.error('[PSGC_CITIES_API] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
        tag: '[PSGC_CITIES_API]',
      },
      { status: 500 }
    );
  }
}
