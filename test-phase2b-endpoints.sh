#!/bin/bash

# Phase 2B Endpoint Tests - Form Storage Protection
# Tests /store-form and /store-anonymous-form endpoints

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load configuration
CONFIG_FILE="test-phase2-config-local.sh"
if [ -f "$CONFIG_FILE" ]; then
  source "$CONFIG_FILE"
  echo "✅ Loaded configuration from $CONFIG_FILE"
else
  echo "⚠️  WARNING: $CONFIG_FILE not found"
  echo "Please create it from test-phase2-config.sh template"
  exit 1
fi

# Backend URL
BACKEND_URL="${BACKEND_URL:-https://my-poppler-api-dev.up.railway.app}"

echo ""
echo "🧪 Phase 2B Endpoint Tests - Form Storage Protection"
echo "======================================================"
echo ""
echo "Backend URL: $BACKEND_URL"
echo "User A Token: ${USER_A_TOKEN:0:20}..."
echo "User A ID: $USER_A_ID"
echo ""

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to test an endpoint
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
  
  local http_code=$(echo "$response_output" | tail -n1 | grep -oE '[0-9]{3}' | tail -1)
  local body=$(echo "$response_output" | sed '$d')
  
  if [ "$http_code" = "$expected_status" ]; then
    echo -e "  ${GREEN}✅ PASS${NC} - Status: $http_code (Expected: $expected_status)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "  ${RED}❌ FAIL${NC} - Status: $http_code (Expected: $expected_status)"
    echo "  Response: $body"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  echo ""
}

# Generate a unique form ID for testing
TEST_FORM_ID="form_test_$(date +%s)_$RANDOM"
TEST_FORM_ID_2="form_test_$(date +%s)_$RANDOM"

echo "📋 Test Form IDs:"
echo "  Test Form 1: $TEST_FORM_ID"
echo "  Test Form 2: $TEST_FORM_ID_2"
echo ""

# ============================================================================
# TEST SUITE 1: /store-form Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUITE 1: /store-form Endpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1.1: No Authentication - Should fail (401)
echo "Test 1.1: Store form without authentication"
test_endpoint \
  "Store Form (No Auth)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "" \
  "401" \
  "Should require authentication" \
  "{\"formData\":{\"id\":\"$TEST_FORM_ID\",\"fields\":[]}}"

# Test 1.2: Create New Form (Authenticated) - Should succeed (200)
echo "Test 1.2: Create new form (authenticated)"
NEW_FORM_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Test Field\"}],\"title\":\"Test Form\"},\"metadata\":{\"source\":\"test\"}}"
test_endpoint \
  "Store Form (New)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_A_TOKEN" \
  "200" \
  "Should allow authenticated user to create new form" \
  "$NEW_FORM_DATA"

# Test 1.3: Update Own Form - Should succeed (200)
# First, we need to create a form owned by USER_A
echo "Test 1.3: Update own form"
# Note: This test assumes we have a form ID from a previous test or use PUBLISHED_FORM_ID
if [ -n "$PUBLISHED_FORM_ID" ]; then
  UPDATE_OWN_FORM_DATA="{\"formData\":{\"id\":\"$PUBLISHED_FORM_ID\",\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Updated Field\"}],\"title\":\"Updated Form\"},\"metadata\":{\"isEdit\":true,\"source\":\"test\"}}"
  test_endpoint \
    "Store Form (Update Own)" \
    "POST" \
    "$BACKEND_URL/store-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Should allow owner to update own form" \
    "$UPDATE_OWN_FORM_DATA"
else
  echo "⚠️  Skipping Test 1.3: PUBLISHED_FORM_ID not set"
  echo ""
fi

# Test 1.4: Update Other User's Form - Should fail (403)
echo "Test 1.4: Update other user's form"
# This test requires a form owned by a different user
# We'll use a form ID that exists but is not owned by USER_A
# For now, we'll test with a non-existent form to verify the logic
UPDATE_OTHER_FORM_DATA="{\"formData\":{\"id\":\"form_other_user_test\",\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Hacked Field\"}],\"title\":\"Hacked Form\"},\"metadata\":{\"isEdit\":true,\"source\":\"test\"}}"
test_endpoint \
  "Store Form (Update Other)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_A_TOKEN" \
  "403" \
  "Should block non-owner from updating form" \
  "$UPDATE_OTHER_FORM_DATA"

# Test 1.5: Clone Published Form (Any User) - Should succeed (200)
echo "Test 1.5: Clone published form"
if [ -n "$PUBLISHED_FORM_ID" ]; then
  CLONE_PUBLISHED_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Cloned Field\"}],\"title\":\"Cloned Form\"},\"metadata\":{\"originalFormId\":\"$PUBLISHED_FORM_ID\",\"source\":\"test\"}}"
  test_endpoint \
    "Store Form (Clone Published)" \
    "POST" \
    "$BACKEND_URL/store-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Should allow any authenticated user to clone published form" \
    "$CLONE_PUBLISHED_DATA"
else
  echo "⚠️  Skipping Test 1.5: PUBLISHED_FORM_ID not set"
  echo ""
fi

# Test 1.6: Clone Draft Form (Owner) - Should succeed (200)
echo "Test 1.6: Clone draft form (owner)"
if [ -n "$DRAFT_FORM_ID" ]; then
  CLONE_DRAFT_OWNER_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Cloned Draft Field\"}],\"title\":\"Cloned Draft Form\"},\"metadata\":{\"originalFormId\":\"$DRAFT_FORM_ID\",\"source\":\"test\"}}"
  test_endpoint \
    "Store Form (Clone Draft - Owner)" \
    "POST" \
    "$BACKEND_URL/store-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Should allow owner to clone own draft form" \
    "$CLONE_DRAFT_OWNER_DATA"
else
  echo "⚠️  Skipping Test 1.6: DRAFT_FORM_ID not set"
  echo ""
fi

# Test 1.7: Clone Non-Existent Form - Should fail (404)
echo "Test 1.7: Clone non-existent form"
CLONE_NONEXISTENT_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Cloned Field\"}],\"title\":\"Cloned Form\"},\"metadata\":{\"originalFormId\":\"form_nonexistent_$(date +%s)\",\"source\":\"test\"}}"
test_endpoint \
  "Store Form (Clone Non-Existent)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_A_TOKEN" \
  "404" \
  "Should return 404 for non-existent source form" \
  "$CLONE_NONEXISTENT_DATA"

# ============================================================================
# TEST SUITE 2: /store-anonymous-form Endpoint
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUITE 2: /store-anonymous-form Endpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 2.1: No Authentication - Should fail (401)
echo "Test 2.1: Store anonymous form without authentication"
test_endpoint \
  "Store Anonymous Form (No Auth)" \
  "POST" \
  "$BACKEND_URL/store-anonymous-form" \
  "" \
  "401" \
  "Should require authentication" \
  "{\"formData\":{\"id\":\"$TEST_FORM_ID_2\",\"fields\":[]}}"

# Test 2.2: Create New Anonymous Form (Authenticated) - Should succeed (200)
echo "Test 2.2: Create new anonymous form (authenticated)"
NEW_ANON_FORM_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Anonymous Test Field\"}],\"title\":\"Anonymous Test Form\"},\"metadata\":{\"source\":\"test\"}}"
test_endpoint \
  "Store Anonymous Form (New)" \
  "POST" \
  "$BACKEND_URL/store-anonymous-form" \
  "$USER_A_TOKEN" \
  "200" \
  "Should allow authenticated user to create new anonymous form" \
  "$NEW_ANON_FORM_DATA"

# Test 2.3: Update Own Anonymous Form - Should succeed (200)
# Note: This would require an existing anonymous form owned by USER_A
echo "Test 2.3: Update own anonymous form"
if [ -n "$PUBLISHED_FORM_ID" ]; then
  UPDATE_OWN_ANON_FORM_DATA="{\"formData\":{\"id\":\"$PUBLISHED_FORM_ID\",\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Updated Anonymous Field\"}],\"title\":\"Updated Anonymous Form\"},\"metadata\":{\"isEdit\":true,\"source\":\"test\"}}"
  test_endpoint \
    "Store Anonymous Form (Update Own)" \
    "POST" \
    "$BACKEND_URL/store-anonymous-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Should allow owner to update own anonymous form" \
    "$UPDATE_OWN_ANON_FORM_DATA"
else
  echo "⚠️  Skipping Test 2.3: PUBLISHED_FORM_ID not set"
  echo ""
fi

# Test 2.4: Clone Published Form via Anonymous Endpoint - Should succeed (200)
echo "Test 2.4: Clone published form via anonymous endpoint"
if [ -n "$PUBLISHED_FORM_ID" ]; then
  CLONE_PUBLISHED_ANON_DATA="{\"formData\":{\"fields\":[{\"id\":\"field1\",\"type\":\"text\",\"label\":\"Cloned Anonymous Field\"}],\"title\":\"Cloned Anonymous Form\"},\"metadata\":{\"originalFormId\":\"$PUBLISHED_FORM_ID\",\"source\":\"test\"}}"
  test_endpoint \
    "Store Anonymous Form (Clone Published)" \
    "POST" \
    "$BACKEND_URL/store-anonymous-form" \
    "$USER_A_TOKEN" \
    "200" \
    "Should allow any authenticated user to clone published form via anonymous endpoint" \
    "$CLONE_PUBLISHED_ANON_DATA"
else
  echo "⚠️  Skipping Test 2.4: PUBLISHED_FORM_ID not set"
  echo ""
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi

