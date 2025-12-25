#!/bin/bash

# Test Auto-Save for Anonymous Forms
# Tests the /api/auto-save-form endpoint for both anonymous and authenticated users

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load configuration
if [ -f "test-phase2-config-local.sh" ]; then
  source test-phase2-config-local.sh
  echo "✅ Loaded configuration from test-phase2-config-local.sh"
else
  echo "⚠️  WARNING: test-phase2-config-local.sh not found"
  echo "   Using default values"
  export BACKEND_URL="https://my-poppler-api-dev.up.railway.app"
  export USER_A_TOKEN="REPLACE_WITH_TOKEN"
  export USER_A_ID="REPLACE_WITH_USER_ID"
fi

echo ""
echo "🧪 Auto-Save Anonymous Forms Test"
echo "=================================="
echo ""
echo "Backend URL: $BACKEND_URL"
echo ""

PASSED=0
FAILED=0

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
  if [ -n "$token" ]; then
    headers="$headers -H 'Authorization: Bearer $token'"
  fi
  
  local response_output
  if [ "$method" = "POST" ]; then
    if [ -n "$data" ]; then
      response_output=$(eval curl -s -w "\n%{http_code}" -X POST "$url" $headers -d "'$data'" 2>&1)
    else
      response_output=$(eval curl -s -w "\n%{http_code}" -X POST "$url" $headers 2>&1)
    fi
  fi
  
  # Extract HTTP status code (last line, should be just the number)
  local http_code=$(echo "$response_output" | tail -n1 | grep -oE '[0-9]{3}' | tail -1)
  local body=$(echo "$response_output" | sed '$d')
  
  if [ "$http_code" = "$expected_status" ]; then
    echo -e "  ${GREEN}✅ PASS${NC} - Status: $http_code (Expected: $expected_status)"
    ((PASSED++))
  else
    echo -e "  ${RED}❌ FAIL${NC} - Status: $http_code (Expected: $expected_status)"
    echo "  Response: $body"
    ((FAILED++))
  fi
  echo ""
}

# ============================================================================
# TEST SUITE: Auto-Save Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUITE: /api/auto-save-form Endpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Create an anonymous form first
echo "📝 Step 1: Creating anonymous form for testing..."
ANON_FORM_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Test Field\"}],\"title\":\"Auto-Save Test Form\"},\"metadata\":{\"source\":\"test\"}}"
ANON_FORM_RESPONSE=$(curl -s -X POST "$BACKEND_URL/store-anonymous-form" \
  -H "Content-Type: application/json" \
  -d "$ANON_FORM_DATA")

ANON_FORM_ID=$(echo "$ANON_FORM_RESPONSE" | grep -o '"formId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ANON_FORM_ID" ]; then
  echo -e "${RED}❌ Failed to create anonymous form${NC}"
  echo "Response: $ANON_FORM_RESPONSE"
  exit 1
fi

echo "✅ Created anonymous form: $ANON_FORM_ID"
echo ""

# Test 1: Anonymous user auto-saving anonymous form - Should succeed (200)
echo "Test 1: Anonymous user auto-saving anonymous form"
AUTO_SAVE_DATA_ANON="{\"formId\":\"$ANON_FORM_ID\",\"formSchema\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Updated Field\"},{\"id\":\"field2\",\"type\":\"text\",\"label\":\"New Field\"}],\"title\":\"Auto-Save Test Form\"}}"
test_endpoint \
  "Auto-Save (Anonymous → Anonymous)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "" \
  "200" \
  "Anonymous user should be able to auto-save anonymous form" \
  "$AUTO_SAVE_DATA_ANON"

# Test 2: Authenticated user auto-saving anonymous form - Should succeed (200)
if [ -n "$USER_A_TOKEN" ] && [ "$USER_A_TOKEN" != "REPLACE_WITH_TOKEN" ]; then
  echo "Test 2: Authenticated user auto-saving anonymous form (conversion)"
  AUTO_SAVE_DATA_AUTH="{\"formId\":\"$ANON_FORM_ID\",\"formSchema\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Updated by Auth User\"}],\"title\":\"Auto-Save Test Form\"}}"
  test_endpoint \
    "Auto-Save (Authenticated → Anonymous)" \
    "POST" \
    "$BACKEND_URL/api/auto-save-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Authenticated user should be able to auto-save anonymous form (conversion)" \
    "$AUTO_SAVE_DATA_AUTH"
else
  echo -e "${YELLOW}⚠️  Skipping Test 2: USER_A_TOKEN not configured${NC}"
  echo ""
fi

# Test 3: Anonymous user trying to auto-save authenticated user's form - Should fail (403)
if [ -n "$PUBLISHED_FORM_ID" ] && [ "$PUBLISHED_FORM_ID" != "REPLACE_WITH_FORM_ID" ]; then
  echo "Test 3: Anonymous user trying to auto-save authenticated form"
  AUTO_SAVE_DATA_UNAUTH="{\"formId\":\"$PUBLISHED_FORM_ID\",\"formSchema\":{\"fields\":[],\"title\":\"Hacked Form\"}}"
  test_endpoint \
    "Auto-Save (Anonymous → Authenticated)" \
    "POST" \
    "$BACKEND_URL/api/auto-save-form" \
    "" \
    "403" \
    "Anonymous user should NOT be able to auto-save authenticated user's form" \
    "$AUTO_SAVE_DATA_UNAUTH"
else
  echo -e "${YELLOW}⚠️  Skipping Test 3: PUBLISHED_FORM_ID not configured${NC}"
  echo ""
fi

# Test 4: Auto-saving non-existent form - Should fail (404)
echo "Test 4: Auto-saving non-existent form"
AUTO_SAVE_DATA_MISSING="{\"formId\":\"form_nonexistent_$(date +%s)\",\"formSchema\":{\"fields\":[],\"title\":\"Missing Form\"}}"
test_endpoint \
  "Auto-Save (Non-Existent Form)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "" \
  "404" \
  "Should return 404 for non-existent form" \
  "$AUTO_SAVE_DATA_MISSING"

# Test 5: Missing formId or formSchema - Should fail (400)
echo "Test 5: Missing formId"
test_endpoint \
  "Auto-Save (Missing formId)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "" \
  "400" \
  "Should return 400 for missing formId" \
  "{\"formSchema\":{\"fields\":[]}}"

echo "Test 6: Missing formSchema"
test_endpoint \
  "Auto-Save (Missing formSchema)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "" \
  "400" \
  "Should return 400 for missing formSchema" \
  "{\"formId\":\"$ANON_FORM_ID\"}"

# ============================================================================
# TEST SUMMARY
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo -e "${GREEN}Tests Passed: $PASSED${NC}"
echo -e "${RED}Tests Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi

