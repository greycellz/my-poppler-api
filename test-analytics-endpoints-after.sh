#!/bin/bash

# Test Analytics Endpoints - AFTER Protection
# This script tests analytics endpoints to verify they are properly protected
# Run this AFTER implementing the protection fixes

BACKEND_URL="${RAILWAY_URL:-https://my-poppler-api-dev.up.railway.app}"
TEST_FORM_ID="${TEST_FORM_ID:-form_1763072981862_kbcturz7d}"  # Replace with actual form ID
WRONG_USER_TOKEN="${WRONG_USER_TOKEN:-}"  # Token for user who doesn't own the form
OWNER_TOKEN="${OWNER_TOKEN:-}"  # Token for form owner

echo "🔒 Testing Analytics Endpoints - AFTER Protection"
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
echo "TEST GROUP 1: Unauthorized Access (No Auth)"
echo "=========================================="
echo "These endpoints should return 401 Unauthorized"
echo ""

# Test 1: Overview endpoint (no auth)
test_endpoint \
  "Overview - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/overview?dateRange=30d" \
  "" \
  "401" \
  "Should require authentication"

# Test 2: Fields endpoint (no auth)
test_endpoint \
  "Fields - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/fields?dateRange=30d" \
  "" \
  "401" \
  "Should require authentication"

# Test 3: Cross-field defaults (no auth)
test_endpoint \
  "Cross-Field Defaults - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/defaults?dateRange=30d" \
  "" \
  "401" \
  "Should require authentication"

# Test 4: Cross-field analyze (no auth)
test_endpoint \
  "Cross-Field Analyze - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/analyze?fieldId1=field1&fieldId2=field2&dateRange=30d" \
  "" \
  "401" \
  "Should require authentication"

# Test 5: Preferences GET (no auth)
test_endpoint \
  "Preferences GET - No Auth" \
  "GET" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
  "" \
  "401" \
  "Should require authentication"

# Test 6: Preferences POST (no auth)
test_endpoint \
  "Preferences POST - No Auth" \
  "POST" \
  "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
  "-H 'Content-Type: application/json' -d '{\"starredFields\":[\"test\"]}'" \
  "401" \
  "Should require authentication"

# Test 7: Custom analyze (no auth)
test_endpoint \
  "Custom Analyze - No Auth" \
  "POST" \
  "$BACKEND_URL/api/analytics/forms/$TEST_FORM_ID/custom/analyze" \
  "-H 'Content-Type: application/json' -d '{\"template_type\":\"breakdown\",\"primary_field_id\":\"field1\",\"secondary_field_id\":\"field2\"}'" \
  "401" \
  "Should require authentication"

echo "=========================================="
echo "TEST GROUP 2: Wrong User Access (Auth but Not Owner)"
echo "=========================================="
echo "These endpoints should return 403 Forbidden"
echo ""

if [ -z "$WRONG_USER_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  WARNING: WRONG_USER_TOKEN not set. Skipping ownership tests.${NC}"
  echo "   Set WRONG_USER_TOKEN to test with a user who doesn't own the form"
  echo ""
else
  # Test 8: Overview (wrong user)
  test_endpoint \
    "Overview - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/overview?dateRange=30d" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"

  # Test 9: Fields (wrong user)
  test_endpoint \
    "Fields - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/fields?dateRange=30d" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"

  # Test 10: Cross-field defaults (wrong user)
  test_endpoint \
    "Cross-Field Defaults - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/defaults?dateRange=30d" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"

  # Test 11: Cross-field analyze (wrong user)
  test_endpoint \
    "Cross-Field Analyze - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/analyze?fieldId1=field1&fieldId2=field2&dateRange=30d" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"

  # Test 12: Preferences GET (wrong user)
  test_endpoint \
    "Preferences GET - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"

  # Test 13: Preferences POST (wrong user)
  test_endpoint \
    "Preferences POST - Wrong User" \
    "POST" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN' -H 'Content-Type: application/json' -d '{\"starredFields\":[\"test\"]}'" \
    "403" \
    "Should deny access to non-owner"

  # Test 14: Cross-field favorites GET (wrong user)
  test_endpoint \
    "Cross-Field Favorites GET - Wrong User" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/favorites" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"

  # Test 15: Cross-field favorites POST (wrong user)
  test_endpoint \
    "Cross-Field Favorites POST - Wrong User" \
    "POST" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/favorites" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN' -H 'Content-Type: application/json' -d '{\"comparisonId\":\"test\",\"isFavorite\":true}'" \
    "403" \
    "Should deny access to non-owner"

  # Test 16: Custom analyze (wrong user)
  test_endpoint \
    "Custom Analyze - Wrong User" \
    "POST" \
    "$BACKEND_URL/api/analytics/forms/$TEST_FORM_ID/custom/analyze" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN' -H 'Content-Type: application/json' -d '{\"template_type\":\"breakdown\",\"primary_field_id\":\"field1\",\"secondary_field_id\":\"field2\"}'" \
    "403" \
    "Should deny access to non-owner"

  # Test 17: Custom saved GET (wrong user)
  test_endpoint \
    "Custom Saved GET - Wrong User" \
    "GET" \
    "$BACKEND_URL/api/analytics/forms/$TEST_FORM_ID/custom/saved?dateRange=30d" \
    "-H 'Authorization: Bearer $WRONG_USER_TOKEN'" \
    "403" \
    "Should deny access to non-owner"
fi

echo "=========================================="
echo "TEST GROUP 3: Owner Access (Should Succeed)"
echo "=========================================="
echo "These endpoints should return 200 OK for form owner"
echo ""

if [ -z "$OWNER_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  WARNING: OWNER_TOKEN not set. Skipping owner tests.${NC}"
  echo "   Set OWNER_TOKEN to test with form owner"
  echo ""
else
  # Test 18: Overview (owner)
  test_endpoint \
    "Overview - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/overview?dateRange=30d" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access"

  # Test 19: Fields (owner)
  test_endpoint \
    "Fields - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/fields?dateRange=30d" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access"

  # Test 20: Cross-field defaults (owner)
  test_endpoint \
    "Cross-Field Defaults - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/cross-field/defaults?dateRange=30d" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access"

  # Test 21: Preferences GET (owner)
  test_endpoint \
    "Preferences GET - Owner" \
    "GET" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $OWNER_TOKEN'" \
    "200" \
    "Owner should be able to access"

  # Test 22: Preferences POST (owner)
  test_endpoint \
    "Preferences POST - Owner" \
    "POST" \
    "$BACKEND_URL/analytics/forms/$TEST_FORM_ID/preferences" \
    "-H 'Authorization: Bearer $OWNER_TOKEN' -H 'Content-Type: application/json' -d '{\"starredFields\":[\"test\"]}'" \
    "200" \
    "Owner should be able to access"

  # Test 23: Custom analyze (owner)
  test_endpoint \
    "Custom Analyze - Owner" \
    "POST" \
    "$BACKEND_URL/api/analytics/forms/$TEST_FORM_ID/custom/analyze" \
    "-H 'Authorization: Bearer $OWNER_TOKEN' -H 'Content-Type: application/json' -d '{\"template_type\":\"breakdown\",\"primary_field_id\":\"field1\",\"secondary_field_id\":\"field2\"}'" \
    "200" \
    "Owner should be able to access"
fi

echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo "Tests Passed: $PASSED"
echo "Tests Failed: $FAILED"
echo ""
echo "📝 Expected Results:"
echo "  - No auth → 401 Unauthorized ✅"
echo "  - Wrong user → 403 Forbidden ✅"
echo "  - Owner → 200 OK ✅"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed - Endpoints are properly protected!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed - Check output above${NC}"
  echo ""
  echo "Common issues:"
  echo "  - Endpoints still unprotected (should return 401/403)"
  echo "  - Ownership check not working (wrong user gets 200 instead of 403)"
  echo "  - Owner access broken (owner gets 401/403 instead of 200)"
  exit 1
fi

