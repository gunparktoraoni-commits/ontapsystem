/**
 * GET /api/psgc/barangays
 * 
 * Fetch barangays for a specific city from PSGC Cloud API
 * 
 * Query Parameters:
 * - cityCode (required): PSGC city code (e.g., "0102812000")
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "code": "0102812001",
 *       "name": "Barangay I (Poblacion)",
 *       "status": "active"
 *     },
 *     {
 *       "code": "0102812002",
 *       "name": "Barangay II (San Nicolas)",
 *       "status": "active"
 *     },
 *     ...
 *   ]
 * }
 * 
 * Error Response (400 Bad Request):
 * {
 *   "success": false,
 *   "error": "City code is required",
 *   "code": "MISSING_CITY_CODE",
 *   "tag": "[PSGC_BARANGAYS_API]"
 * }
 * 
 * Error Response (500 Server Error):
 * {
 *   "success": false,
 *   "error": "Failed to fetch barangays",
 *   "code": "BARANGAYS_FETCH_FAILED",
 *   "tag": "[PSGC_BARANGAYS_API]"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchBarangaysByCity, PSGCCloudError } from '@/lib/services/psgc-cloud-api';

export async function GET(request: NextRequest) {
  try {
    // Validate request method
    if (request.method !== 'GET') {
      return NextResponse.json(
        {
          success: false,
          error: 'Method not allowed',
          code: 'METHOD_NOT_ALLOWED',
          tag: '[PSGC_BARANGAYS_API]',
        },
        { status: 405 }
      );
    }

    // Extract and validate query parameters
    const { searchParams } = new URL(request.url);
    const cityCode = searchParams.get('cityCode');

    if (!cityCode) {
      return NextResponse.json(
        {
          success: false,
          error: 'City code is required',
          code: 'MISSING_CITY_CODE',
          tag: '[PSGC_BARANGAYS_API]',
        },
        { status: 400 }
      );
    }

    // Validate city code format (should be 10 digits)
    if (!/^\d{10}$/.test(cityCode)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid city code format (expected 10 digits)',
          code: 'INVALID_CITY_CODE_FORMAT',
          tag: '[PSGC_BARANGAYS_API]',
        },
        { status: 400 }
      );
    }

    // Fetch barangays for city
    const barangays = await fetchBarangaysByCity(cityCode);

    return NextResponse.json(
      {
        success: true,
        data: barangays,
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
    console.error('[PSGC_BARANGAYS_API] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
        tag: '[PSGC_BARANGAYS_API]',
      },
      { status: 500 }
    );
  }
}
