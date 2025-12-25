#!/bin/bash

# Phase 2A Endpoints - AFTER Implementation Tests
# Tests Phase 2A critical security fixes

# Load configuration if available
if [ -f "./test-phase2-config-local.sh" ]; then
  source ./test-phase2-config-local.sh
  echo "✅ Loaded local configuration"
else
  echo "⚠️  WARNING: test-phase2-config-local.sh not found"
  echo "   Copy test-phase2-config.sh to test-phase2-config-local.sh and fill in real values"
  echo "   Using default BACKEND_URL"
fi

BACKEND_URL="${BACKEND_URL:-https://my-poppler-api-dev.up.railway.app}"

echo "🔒 Phase 2A Endpoints - AFTER Implementation Tests"
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
  local data=$7
  
  echo "Testing: $name"
  echo "  Description: $description"
  
  local headers="-H 'Content-Type: application/json'"
  if [ -n "$token" ] && [ "$token" != "REPLACE_WITH"* ]; then
    headers="$headers -H 'Authorization: Bearer $token'"
  fi
  
  local response
  if [ "$method" = "GET" ]; then
    response=$(eval curl -s -w "\n%{http_code}" -X GET "$url" $headers 2>&1)
  elif [ "$method" = "POST" ]; then
    if [ -n "$data" ]; then
      response=$(eval curl -s -w "\n%{http_code}" -X POST "$url" $headers -d "'$data'" 2>&1)
    else
      response=$(eval curl -s -w "\n%{http_code}" -X POST "$url" $headers 2>&1)
    fi
  fi
  
  local http_code=$(echo "$response" | tail -n1 | grep -oE '[0-9]{3}' | tail -1)
  local body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "$expected_status" ]; then
    echo -e "  ${GREEN}✅ PASS${NC} - Status: $http_code (Expected: $expected_status)"
    return 0
  else
    echo -e "  ${RED}❌ FAIL${NC} - Status: $http_code (Expected: $expected_status)"
    if [ -n "$body" ]; then
      echo "  Response: $(echo "$body" | head -c 200)"
    fi
    return 1
  fi
}

# Check if config is loaded
if [ "$USER_A_TOKEN" = "REPLACE_WITH_USER_A_TOKEN" ] || [ -z "$USER_A_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  Configuration not loaded. Please create test-phase2-config-local.sh${NC}"
  echo ""
  echo "Quick test without config (will use placeholder values):"
  echo ""
fi

PASSED=0
FAILED=0

# Test Suite 1: Debug Endpoints
echo "=== Test Suite 1: Debug Endpoints ==="
echo ""

# Test 1.1: Debug endpoint should return 404 (disabled in production)
test_endpoint \
  "GET /api/debug/payment-fields/:formId (should be disabled)" \
  "GET" \
  "$BACKEND_URL/api/debug/payment-fields/test-form-id" \
  "" \
  "404" \
  "Debug endpoints should return 404 when disabled"

if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi

# Test 1.2: Debug cleanup endpoint should return 404
test_endpoint \
  "POST /api/debug/cleanup-payment-fields/:formId/:fieldId (should be disabled)" \
  "POST" \
  "$BACKEND_URL/api/debug/cleanup-payment-fields/test-form-id/test-field-id" \
  "" \
  "404" \
  "Debug cleanup endpoint should return 404 when disabled"

if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi

# Test Suite 2: Auto-Save Endpoint
echo "=== Test Suite 2: Auto-Save Endpoint ==="
echo ""

if [ "$USER_A_TOKEN" != "REPLACE_WITH_USER_A_TOKEN" ] && [ -n "$USER_A_TOKEN" ] && [ "$FORM_A_ID" != "REPLACE_WITH_FORM_A_ID" ] && [ -n "$FORM_A_ID" ]; then
  # Test 2.1: Auto-save own form - Should succeed
  test_endpoint \
    "POST /api/auto-save-form (own form)" \
    "POST" \
    "$BACKEND_URL/api/auto-save-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Owner can auto-save own form" \
    "{\"formId\":\"$FORM_A_ID\",\"formSchema\":{\"title\":\"Auto-saved\"}}"
  
  if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  
  # Test 2.2: Auto-save (unauthenticated on authenticated user's form) - Should fail (403)
  test_endpoint \
    "POST /api/auto-save-form (unauthenticated on auth form)" \
    "POST" \
    "$BACKEND_URL/api/auto-save-form" \
    "" \
    "403" \
    "Anonymous user cannot auto-save authenticated user's form" \
    "{\"formId\":\"$FORM_A_ID\",\"formSchema\":{\"title\":\"Test\"}}"
  
  if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  
  # Test 2.2b: Auto-save (unauthenticated on anonymous form) - Should succeed (200)
  # Note: This requires an anonymous form ID - we'll create one first or use a known anonymous form
  # For now, we'll skip this test if we don't have an anonymous form ID
  if [ -n "$ANONYMOUS_FORM_ID" ] && [ "$ANONYMOUS_FORM_ID" != "REPLACE_WITH_ANONYMOUS_FORM_ID" ]; then
    test_endpoint \
      "POST /api/auto-save-form (unauthenticated on anonymous form)" \
      "POST" \
      "$BACKEND_URL/api/auto-save-form" \
      "" \
      "200" \
      "Anonymous user can auto-save anonymous form" \
      "{\"formId\":\"$ANONYMOUS_FORM_ID\",\"formSchema\":{\"title\":\"Auto-saved anonymous\"}}"
    
    if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  else
    echo -e "${YELLOW}⚠️  Skipping anonymous form auto-save test (ANONYMOUS_FORM_ID not configured)${NC}"
    echo ""
  fi
  
  # Test 2.3: Auto-save other user's form - Should fail
  if [ "$USER_B_TOKEN" != "REPLACE_WITH_USER_B_TOKEN" ] && [ -n "$USER_B_TOKEN" ]; then
    test_endpoint \
      "POST /api/auto-save-form (other user's form)" \
      "POST" \
      "$BACKEND_URL/api/auto-save-form" \
      "$USER_B_TOKEN" \
      "403" \
      "User cannot auto-save other user's form" \
      "{\"formId\":\"$FORM_A_ID\",\"formSchema\":{}}"
    
    if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  else
    echo -e "${YELLOW}⚠️  Skipping cross-user test (USER_B_TOKEN not configured)${NC}"
    echo ""
  fi
else
  echo -e "${YELLOW}⚠️  Skipping auto-save tests (tokens/form IDs not configured)${NC}"
  echo ""
fi

# Test Suite 3: User Forms List Endpoint
echo "=== Test Suite 3: User Forms List Endpoint ==="
echo ""

if [ "$USER_A_TOKEN" != "REPLACE_WITH_USER_A_TOKEN" ] && [ -n "$USER_A_TOKEN" ] && [ "$USER_A_ID" != "REPLACE_WITH_USER_A_ID" ] && [ -n "$USER_A_ID" ]; then
  # Test 3.1: Get own forms - Should succeed
  test_endpoint \
    "GET /api/forms/user/:userId (own forms)" \
    "GET" \
    "$BACKEND_URL/api/forms/user/$USER_A_ID" \
    "$USER_A_TOKEN" \
    "200" \
    "User can get own forms"
  
  if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  
  # Test 3.2: Get forms (unauthenticated) - Should fail
  test_endpoint \
    "GET /api/forms/user/:userId (unauthenticated)" \
    "GET" \
    "$BACKEND_URL/api/forms/user/$USER_A_ID" \
    "" \
    "401" \
    "Unauthenticated user cannot get forms"
  
  if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  
  # Test 3.3: Get other user's forms - Should fail
  if [ "$USER_B_ID" != "REPLACE_WITH_USER_B_ID" ] && [ -n "$USER_B_ID" ]; then
    test_endpoint \
      "GET /api/forms/user/:userId (other user's forms)" \
      "GET" \
      "$BACKEND_URL/api/forms/user/$USER_B_ID" \
      "$USER_A_TOKEN" \
      "403" \
      "User cannot get other user's forms"
    
    if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
  else
    echo -e "${YELLOW}⚠️  Skipping cross-user test (USER_B_ID not configured)${NC}"
    echo ""
  fi
else
  echo -e "${YELLOW}⚠️  Skipping user forms tests (tokens/user IDs not configured)${NC}"
  echo ""
fi

# Test Suite 4: Form Submission Endpoint
echo "=== Test Suite 4: Form Submission Endpoint ==="
echo ""

# Test 4.1: Submit to non-existent form - Should fail with 404
test_endpoint \
  "POST /submit-form (non-existent form)" \
  "POST" \
  "$BACKEND_URL/submit-form" \
  "" \
  "404" \
  "Cannot submit to non-existent form" \
  '{"formId":"form_nonexistent_12345","formData":{}}'

if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi

if [ "$DRAFT_FORM_ID" != "REPLACE_WITH_DRAFT_FORM_ID" ] && [ -n "$DRAFT_FORM_ID" ]; then
  # Test 4.2: Submit to draft form - Should fail with 403
  test_endpoint \
    "POST /submit-form (draft form)" \
    "POST" \
    "$BACKEND_URL/submit-form" \
    "" \
    "403" \
    "Cannot submit to draft form" \
    "{\"formId\":\"$DRAFT_FORM_ID\",\"formData\":{}}"
  
  if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
else
  echo -e "${YELLOW}⚠️  Skipping draft form test (DRAFT_FORM_ID not configured)${NC}"
  echo ""
fi

if [ "$PUBLISHED_FORM_ID" != "REPLACE_WITH_PUBLISHED_FORM_ID" ] && [ -n "$PUBLISHED_FORM_ID" ]; then
  # Test 4.3: Submit to published form - Should succeed
  test_endpoint \
    "POST /submit-form (published form)" \
    "POST" \
    "$BACKEND_URL/submit-form" \
    "" \
    "200" \
    "Can submit to published form" \
    "{\"formId\":\"$PUBLISHED_FORM_ID\",\"formData\":{\"test_field\":\"test_value\"}}"
  
  if [ $? -eq 0 ]; then ((PASSED++)); else ((FAILED++)); fi
else
  echo -e "${YELLOW}⚠️  Skipping published form test (PUBLISHED_FORM_ID not configured)${NC}"
  echo ""
fi

# Summary
echo "=================================================="
echo "📊 Test Summary"
echo "=================================================="
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}⚠️  Some tests failed. Please review the output above.${NC}"
  exit 1
fi

