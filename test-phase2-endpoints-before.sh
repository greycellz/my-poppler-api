#!/bin/bash

# Phase 2 Endpoints - BEFORE Implementation Tests
# Tests all endpoints to document current unprotected state

BACKEND_URL="${BACKEND_URL:-https://my-poppler-api-dev.up.railway.app}"

echo "🔍 Phase 2 Endpoints - BEFORE Implementation Tests"
echo "=================================================="
echo "Backend URL: $BACKEND_URL"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test helper function
test_endpoint() {
  local name=$1
  local method=$2
  local url=$3
  local token=$4
  local expected_status=$5
  local description=$6
  
  echo "Testing: $name"
  echo "  Description: $description"
  
  local headers=""
  if [ -n "$token" ]; then
    headers="-H 'Authorization: Bearer $token'"
  fi
  
  local response
  if [ "$method" = "GET" ]; then
    response=$(eval curl -s -w "\n%{http_code}" -X GET "$url" $headers 2>&1)
  elif [ "$method" = "POST" ]; then
    response=$(eval curl -s -w "\n%{http_code}" -X POST "$url" $headers 2>&1)
  elif [ "$method" = "PUT" ]; then
    response=$(eval curl -s -w "\n%{http_code}" -X PUT "$url" $headers 2>&1)
  elif [ "$method" = "DELETE" ]; then
    response=$(eval curl -s -w "\n%{http_code}" -X DELETE "$url" $headers 2>&1)
  fi
  
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "$expected_status" ]; then
    echo -e "  ${GREEN}✅ PASS${NC} - Status: $http_code (Expected: $expected_status)"
  else
    echo -e "  ${RED}❌ FAIL${NC} - Status: $http_code (Expected: $expected_status)"
    echo "  Response: $body"
  fi
  echo ""
}

# Note: These tests require actual form IDs and user tokens
# Replace with real values before running

echo "⚠️  NOTE: Replace placeholder values with real form IDs and tokens before running"
echo ""

# Test Suite 1: Form Storage Endpoints
echo "=== Test Suite 1: Form Storage Endpoints ==="
echo ""

# Test 1.1: Create new form (unauthenticated) - Should currently work (will fail after fix)
test_endpoint \
  "POST /store-form (unauthenticated)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "" \
  "200" \
  "Currently allows unauthenticated form creation (should require auth after fix)"

# Test 1.2: Update form (unauthenticated) - Should currently work (will fail after fix)
test_endpoint \
  "POST /store-form (update, unauthenticated)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "" \
  "200" \
  "Currently allows unauthenticated form updates (should require auth + ownership after fix)"

# Test Suite 2: Auto-Save Endpoint
echo "=== Test Suite 2: Auto-Save Endpoint ==="
echo ""

# Test 2.1: Auto-save (unauthenticated) - Should currently work (will fail after fix)
test_endpoint \
  "POST /api/auto-save-form (unauthenticated)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "" \
  "200" \
  "Currently allows unauthenticated auto-save (should require auth + ownership after fix)"

# Test Suite 3: Form Submission Endpoint
echo "=== Test Suite 3: Form Submission Endpoint ==="
echo ""

# Test 3.1: Submit to non-existent form - Should currently return error (will return 404 after fix)
test_endpoint \
  "POST /submit-form (non-existent)" \
  "POST" \
  "$BACKEND_URL/submit-form" \
  "" \
  "500" \
  "Currently returns 500 for non-existent form (should return 404 after fix)"

# Test 3.2: Submit to draft form - Should currently work (will fail after fix)
# Note: Replace DRAFT_FORM_ID with actual draft form ID
test_endpoint \
  "POST /submit-form (draft form)" \
  "POST" \
  "$BACKEND_URL/submit-form" \
  "" \
  "200" \
  "Currently allows submissions to draft forms (should return 403 after fix)"

# Test Suite 4: Form Image Endpoints
echo "=== Test Suite 4: Form Image Endpoints ==="
echo ""

# Test 4.1: Get images (unauthenticated) - Should currently work (will fail after fix)
# Note: Replace FORM_ID and FIELD_ID with actual values
test_endpoint \
  "GET /form-images/:formId/:fieldId (unauthenticated)" \
  "GET" \
  "$BACKEND_URL/form-images/FORM_ID/FIELD_ID" \
  "" \
  "200" \
  "Currently allows unauthenticated image access (should require auth + ownership after fix)"

# Test Suite 5: User Forms List Endpoint
echo "=== Test Suite 5: User Forms List Endpoint ==="
echo ""

# Test 5.1: Get forms (unauthenticated) - Should currently work (will fail after fix)
# Note: Replace USER_ID with actual user ID
test_endpoint \
  "GET /api/forms/user/:userId (unauthenticated)" \
  "GET" \
  "$BACKEND_URL/api/forms/user/USER_ID" \
  "" \
  "200" \
  "Currently allows unauthenticated access (should require auth after fix)"

# Test 5.2: Get other user's forms - Should currently work (will fail after fix)
# Note: Replace USER_A_TOKEN and USER_B_ID with actual values
test_endpoint \
  "GET /api/forms/user/:userId (other user)" \
  "GET" \
  "$BACKEND_URL/api/forms/user/USER_B_ID" \
  "USER_A_TOKEN" \
  "200" \
  "Currently allows viewing other user's forms (should return 403 after fix)"

# Test Suite 6: Debug Endpoints
echo "=== Test Suite 6: Debug Endpoints ==="
echo ""

# Test 6.1: Debug endpoint (production) - Should currently work (will return 404 after fix)
test_endpoint \
  "GET /api/debug/payment-fields/:formId" \
  "GET" \
  "$BACKEND_URL/api/debug/payment-fields/FORM_ID" \
  "" \
  "200" \
  "Currently accessible in production (should return 404 after fix)"

echo ""
echo "✅ BEFORE tests complete"
echo ""
echo "📝 Document these results - they show the current unprotected state"
echo "After implementation, run test-phase2-endpoints-after.sh to verify fixes"

