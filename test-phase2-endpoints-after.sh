#!/bin/bash

# Phase 2 Endpoints - AFTER Implementation Tests
# Tests all endpoints to verify protection is working

BACKEND_URL="${BACKEND_URL:-https://my-poppler-api-dev.up.railway.app}"

echo "🔒 Phase 2 Endpoints - AFTER Implementation Tests"
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
  if [ -n "$token" ]; then
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

# Configuration
# Replace these with actual values before running
USER_A_TOKEN="REPLACE_WITH_USER_A_TOKEN"
USER_B_TOKEN="REPLACE_WITH_USER_B_TOKEN"
FORM_A_ID="REPLACE_WITH_FORM_A_ID"  # Owned by User A
FORM_B_ID="REPLACE_WITH_FORM_B_ID"  # Owned by User B
PUBLISHED_FORM_ID="REPLACE_WITH_PUBLISHED_FORM_ID"
DRAFT_FORM_ID="REPLACE_WITH_DRAFT_FORM_ID"
USER_A_ID="REPLACE_WITH_USER_A_ID"
USER_B_ID="REPLACE_WITH_USER_B_ID"
FIELD_ID="REPLACE_WITH_FIELD_ID"
IMAGE_ID="REPLACE_WITH_IMAGE_ID"

echo "⚠️  NOTE: Replace placeholder values with real form IDs and tokens before running"
echo ""

# Test Suite 1: Form Storage Endpoints
echo "=== Test Suite 1: Form Storage Endpoints ==="
echo ""

# Test 1.1: Create new form (authenticated) - Should succeed
test_endpoint \
  "POST /store-form (authenticated, new form)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_A_TOKEN" \
  "200" \
  "Authenticated user can create new form" \
  '{"formData":{"title":"Test Form","fields":[]},"metadata":{}}'

# Test 1.2: Create new form (unauthenticated) - Should fail
test_endpoint \
  "POST /store-form (unauthenticated)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "" \
  "401" \
  "Unauthenticated user cannot create form" \
  '{"formData":{"title":"Test Form","fields":[]}}'

# Test 1.3: Update own form - Should succeed
test_endpoint \
  "POST /store-form (update own form)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_A_TOKEN" \
  "200" \
  "Owner can update own form" \
  "{\"formData\":{\"formId\":\"$FORM_A_ID\",\"title\":\"Updated\"},\"metadata\":{\"isEdit\":true}}"

# Test 1.4: Update other user's form - Should fail
test_endpoint \
  "POST /store-form (update other user's form)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_B_TOKEN" \
  "403" \
  "User cannot update other user's form" \
  "{\"formData\":{\"formId\":\"$FORM_A_ID\",\"title\":\"Hacked\"},\"metadata\":{\"isEdit\":true}}"

# Test 1.5: Clone published form (any user) - Should succeed
test_endpoint \
  "POST /store-form (clone published form)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_B_TOKEN" \
  "200" \
  "Any user can clone published form" \
  "{\"formData\":{\"title\":\"Cloned\"},\"metadata\":{\"originalFormId\":\"$PUBLISHED_FORM_ID\",\"source\":\"clone\"}}"

# Test 1.6: Clone draft form (owner) - Should succeed
test_endpoint \
  "POST /store-form (clone own draft form)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_A_TOKEN" \
  "200" \
  "Owner can clone own draft form" \
  "{\"formData\":{\"title\":\"Cloned\"},\"metadata\":{\"originalFormId\":\"$DRAFT_FORM_ID\",\"source\":\"clone\"}}"

# Test 1.7: Clone draft form (non-owner) - Should fail
test_endpoint \
  "POST /store-form (clone other user's draft form)" \
  "POST" \
  "$BACKEND_URL/store-form" \
  "$USER_B_TOKEN" \
  "403" \
  "User cannot clone other user's draft form" \
  "{\"formData\":{\"title\":\"Hacked\"},\"metadata\":{\"originalFormId\":\"$DRAFT_FORM_ID\",\"source\":\"clone\"}}"

# Test Suite 2: Auto-Save Endpoint
echo "=== Test Suite 2: Auto-Save Endpoint ==="
echo ""

# Test 2.1: Auto-save own form - Should succeed
test_endpoint \
  "POST /api/auto-save-form (own form)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "$USER_A_TOKEN" \
  "200" \
  "Owner can auto-save own form" \
  "{\"formId\":\"$FORM_A_ID\",\"formSchema\":{\"title\":\"Auto-saved\"}}"

# Test 2.2: Auto-save (unauthenticated) - Should fail
test_endpoint \
  "POST /api/auto-save-form (unauthenticated)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "" \
  "401" \
  "Unauthenticated user cannot auto-save" \
  "{\"formId\":\"$FORM_A_ID\",\"formSchema\":{}}"

# Test 2.3: Auto-save other user's form - Should fail
test_endpoint \
  "POST /api/auto-save-form (other user's form)" \
  "POST" \
  "$BACKEND_URL/api/auto-save-form" \
  "$USER_B_TOKEN" \
  "403" \
  "User cannot auto-save other user's form" \
  "{\"formId\":\"$FORM_A_ID\",\"formSchema\":{}}"

# Test Suite 3: Form Submission Endpoint
echo "=== Test Suite 3: Form Submission Endpoint ==="
echo ""

# Test 3.1: Submit to published form - Should succeed
test_endpoint \
  "POST /submit-form (published form)" \
  "POST" \
  "$BACKEND_URL/submit-form" \
  "" \
  "200" \
  "Can submit to published form" \
  "{\"formId\":\"$PUBLISHED_FORM_ID\",\"formData\":{\"field1\":\"value1\"}}"

# Test 3.2: Submit to non-existent form - Should fail with 404
test_endpoint \
  "POST /submit-form (non-existent form)" \
  "POST" \
  "$BACKEND_URL/submit-form" \
  "" \
  "404" \
  "Cannot submit to non-existent form" \
  '{"formId":"form_nonexistent","formData":{}}'

# Test 3.3: Submit to draft form - Should fail with 403
test_endpoint \
  "POST /submit-form (draft form)" \
  "POST" \
  "$BACKEND_URL/submit-form" \
  "" \
  "403" \
  "Cannot submit to draft form" \
  "{\"formId\":\"$DRAFT_FORM_ID\",\"formData\":{}}"

# Test Suite 4: Form Image Endpoints
echo "=== Test Suite 4: Form Image Endpoints ==="
echo ""

# Test 4.1: Get images (owner) - Should succeed
test_endpoint \
  "GET /form-images/:formId/:fieldId (owner)" \
  "GET" \
  "$BACKEND_URL/form-images/$FORM_A_ID/$FIELD_ID" \
  "$USER_A_TOKEN" \
  "200" \
  "Owner can get form images"

# Test 4.2: Get images (unauthenticated) - Should fail
test_endpoint \
  "GET /form-images/:formId/:fieldId (unauthenticated)" \
  "GET" \
  "$BACKEND_URL/form-images/$FORM_A_ID/$FIELD_ID" \
  "" \
  "401" \
  "Unauthenticated user cannot get form images"

# Test 4.3: Get images (other user) - Should fail
test_endpoint \
  "GET /form-images/:formId/:fieldId (other user)" \
  "GET" \
  "$BACKEND_URL/form-images/$FORM_A_ID/$FIELD_ID" \
  "$USER_B_TOKEN" \
  "403" \
  "User cannot get other user's form images"

# Test Suite 5: User Forms List Endpoint
echo "=== Test Suite 5: User Forms List Endpoint ==="
echo ""

# Test 5.1: Get own forms - Should succeed
test_endpoint \
  "GET /api/forms/user/:userId (own forms)" \
  "GET" \
  "$BACKEND_URL/api/forms/user/$USER_A_ID" \
  "$USER_A_TOKEN" \
  "200" \
  "User can get own forms"

# Test 5.2: Get forms (unauthenticated) - Should fail
test_endpoint \
  "GET /api/forms/user/:userId (unauthenticated)" \
  "GET" \
  "$BACKEND_URL/api/forms/user/$USER_A_ID" \
  "" \
  "401" \
  "Unauthenticated user cannot get forms"

# Test 5.3: Get other user's forms - Should fail
test_endpoint \
  "GET /api/forms/user/:userId (other user's forms)" \
  "GET" \
  "$BACKEND_URL/api/forms/user/$USER_B_ID" \
  "$USER_A_TOKEN" \
  "403" \
  "User cannot get other user's forms"

# Test Suite 6: Debug Endpoints
echo "=== Test Suite 6: Debug Endpoints ==="
echo ""

# Test 6.1: Debug endpoint (production) - Should return 404
test_endpoint \
  "GET /api/debug/payment-fields/:formId (production)" \
  "GET" \
  "$BACKEND_URL/api/debug/payment-fields/$FORM_A_ID" \
  "" \
  "404" \
  "Debug endpoints disabled in production"

echo ""
echo "✅ AFTER tests complete"
echo ""
echo "📊 Summary:"
echo "  - All unauthenticated requests should return 401"
echo "  - All unauthorized requests should return 403"
echo "  - All owner requests should return 200"
echo "  - Debug endpoints should return 404 in production"

