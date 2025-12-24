#!/bin/bash

# Test Analytics Endpoints - BEFORE Protection
# This script tests analytics endpoints to verify they are currently unprotected
# Run this BEFORE implementing the protection fixes

BACKEND_URL="${RAILWAY_URL:-https://my-poppler-api-dev.up.railway.app}"
TEST_FORM_ID="${TEST_FORM_ID:-form_1763072981862_kbcturz7d}"  # Replace with actual form ID
WRONG_USER_TOKEN="${WRONG_USER_TOKEN:-}"  # Token for user who doesn't own the form
OWNER_TOKEN="${OWNER_TOKEN:-}"  # Token for form owner

echo "🔍 Testing Analytics Endpoints - BEFORE Protection"
echo "=================================================="
echo "Backend URL: $BACKEND_URL"
echo "Test Form ID: $TEST_FORM_ID"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Test function
test_endpoint() {
  local name=$1
  local method=$2
  local url=$3
  local headers=$4
  local expected_status=$5
  local description=$6
  
  echo "📋 Test: $name"
  echo "   Description: $description"
  echo "   URL: $url"
  
  if [ -n "$headers" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" $headers)
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$url")
  fi
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" == "$expected_status" ]; then
    echo -e "   ${GREEN}✅ PASS${NC} - Status: $http_code (Expected: $expected_status)"
    ((PASSED++))
  else
    echo -e "   ${RED}❌ FAIL${NC} - Status: $http_code (Expected: $expected_status)"
    echo "   Response: $body"
    ((FAILED++))
  fi
  echo ""
}

echo "=========================================="
echo "TEST GROUP 1: Unprotected Endpoints (No Auth)"
echo "=========================================="
echo "These endpoints should currently work WITHOUT authentication"
echo "After fix, they should return 401 Unauthorized"
echo ""

# Test 1: Overview endpoint (no auth)
test_endpoint \
  "Overview - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/overview?dateRange=30d" \
  "" \
  "200" \
  "Should work without auth (BEFORE fix) - will fail after fix"

# Test 2: Fields endpoint (no auth)
test_endpoint \
  "Fields - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/fields?dateRange=30d" \
  "" \
  "200" \
  "Should work without auth (BEFORE fix) - will fail after fix"

# Test 3: Cross-field defaults (no auth)
test_endpoint \
  "Cross-Field Defaults - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/defaults?dateRange=30d" \
  "" \
  "200" \
  "Should work without auth (BEFORE fix) - will fail after fix"

# Test 4: Cross-field analyze (no auth)
test_endpoint \
  "Cross-Field Analyze - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/analyze?fieldId1=field1&fieldId2=field2&dateRange=30d" \
  "" \
  "200" \
  "Should work without auth (BEFORE fix) - will fail after fix"

echo "=========================================="
echo "TEST GROUP 2: Partially Protected Endpoints (Auth but No Ownership)"
echo "=========================================="
echo "These endpoints require auth but don't check ownership"
echo "After fix, wrong-user requests should return 403 Forbidden"
echo ""

if [ -z "$WRONG_USER_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  WARNING: WRONG_USER_TOKEN not set. Skipping ownership tests.${NC}"
  echo "   Set WRONG_USER_TOKEN to test with a user who doesn't own the form"
  echo ""
else
  # Test 5: Preferences GET (wrong user)
  test_endpoint \
    "Preferences GET - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "200" \
    "Should work with any authenticated user (BEFORE fix) - will fail after fix"

  # Test 6: Preferences POST (wrong user)
  test_endpoint \
    "Preferences POST - Wrong User" \
    "POST" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN' -H 'Content-Type: application/json' -d '{\"starredFields\":[\"test\"]}'" \
    "200" \
    "Should work with any authenticated user (BEFORE fix) - will fail after fix"

  # Test 7: Cross-field favorites GET (wrong user)
  test_endpoint \
    "Cross-Field Favorites GET - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/favorites" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "200" \
    "Should work with any authenticated user (BEFORE fix) - will fail after fix"

  # Test 8: Custom analyze (wrong user)
  test_endpoint \
    "Custom Analyze - Wrong User" \
    "POST" \
    "$BACKEND_URL/api/analytics/forms/$TEST_FORM_ID/custom/analyze" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN' -H 'Content-Type: application/json' -d '{\"template_type\":\"breakdown\",\"primary_field_id\":\"field1\",\"secondary_field_id\":\"field2\"}'" \
    "200" \
    "Should work with any authenticated user (BEFORE fix) - will fail after fix"
fi

echo "=========================================="
echo "TEST GROUP 3: Owner Access (Should Work)"
echo "=========================================="
echo "These tests verify owner can access their own form"
echo "Should work both BEFORE and AFTER fix"
echo ""

if [ -z "$OWNER_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  WARNING: OWNER_TOKEN not set. Skipping owner tests.${NC}"
  echo "   Set OWNER_TOKEN to test with form owner"
  echo ""
else
  # Test 9: Overview (owner)
  test_endpoint \
    "Overview - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/overview?dateRange=30d" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access (BEFORE and AFTER fix)"

  # Test 10: Fields (owner)
  test_endpoint \
    "Fields - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/fields?dateRange=30d" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access (BEFORE and AFTER fix)"

  # Test 11: Preferences GET (owner)
  test_endpoint \
    "Preferences GET - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access (BEFORE and AFTER fix)"
fi

echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo "Tests Passed: $PASSED"
echo "Tests Failed: $FAILED"
echo ""
echo "📝 Notes:"
echo "  - Tests marked as 'PASS' here indicate endpoints are currently unprotected"
echo "  - After implementing fixes, re-run with test-analytics-endpoints-after.sh"
echo "  - Expected behavior AFTER fix:"
echo "    - No auth → 401 Unauthorized"
echo "    - Wrong user → 403 Forbidden"
echo "    - Owner → 200 OK"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed (endpoints are currently unprotected as expected)${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed - check output above${NC}"
  exit 1
fi

