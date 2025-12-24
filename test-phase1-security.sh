#!/bin/bash

# Phase 1 Security Testing Script
# Tests authorization and security fixes

BACKEND_URL="${RAILWAY_URL:-https://my-poppler-api-dev.up.railway.app}"

echo "🔒 Phase 1 Security Testing"
echo "=========================="
echo "Backend URL: $BACKEND_URL"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "📋 Testing Checklist:"
echo ""
echo "1. ✅ CORS (already tested)"
echo "2. ⚠️  JWT_SECRET validation (server startup - already passed)"
echo "3. ⚠️  Form deletion endpoint (requires auth + ownership)"
echo "4. ⚠️  File upload endpoint (feature flag controlled)"
echo "5. ⚠️  File download endpoint (auth for unpublished forms)"
echo "6. ⚠️  Submissions endpoints (require auth + ownership)"
echo "7. ⚠️  Form retrieval endpoint (protect drafts)"
echo ""

echo "=========================================="
echo "TEST 1: Form Deletion (Should Require Auth)"
echo "=========================================="
echo "Attempting to delete form without auth..."
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X DELETE "$BACKEND_URL/api/forms/test-form-id")
http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✅ PASS: Form deletion requires authentication${NC}"
else
    echo -e "${RED}❌ FAIL: Expected 401, got $http_code${NC}"
fi
echo ""

echo "=========================================="
echo "TEST 2: Submissions Endpoint (Should Require Auth)"
echo "=========================================="
echo "Attempting to get submissions without auth..."
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BACKEND_URL/api/forms/test-form-id/submissions")
http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✅ PASS: Submissions endpoint requires authentication${NC}"
else
    echo -e "${RED}❌ FAIL: Expected 401, got $http_code${NC}"
fi
echo ""

echo "=========================================="
echo "TEST 3: Submission Data Endpoint (Should Require Auth)"
echo "=========================================="
echo "Attempting to get submission data without auth..."
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BACKEND_URL/api/submissions/test-submission-id/data")
http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✅ PASS: Submission data endpoint requires authentication${NC}"
else
    echo -e "${RED}❌ FAIL: Expected 401, got $http_code${NC}"
fi
echo ""

echo "=========================================="
echo "TEST 4: File Upload (Feature Flag Controlled)"
echo "=========================================="
echo "Checking file upload endpoint..."
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$BACKEND_URL/upload-file" \
  -F "file=@/dev/null" \
  -F "formId=test" \
  -F "fieldId=test")
http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
echo "HTTP Status: $http_code"
echo "Note: With ENABLE_FILE_UPLOAD_AUTH=false, this should work without auth"
echo "      With ENABLE_FILE_UPLOAD_AUTH=true, this should require auth"
echo ""

echo "=========================================="
echo "TEST 5: Form Retrieval (Draft Protection)"
echo "=========================================="
echo "Attempting to get form (should work for published, require auth for drafts)..."
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BACKEND_URL/api/forms/test-form-id")
http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
echo "HTTP Status: $http_code"
echo "Note: Published forms should work, draft forms should require auth"
echo ""

echo "=========================================="
echo "Summary"
echo "=========================================="
echo "✅ CORS: Tested and working"
echo "✅ JWT_SECRET: Validated on startup"
echo "⚠️  Authorization: Needs testing with valid JWT tokens"
echo "⚠️  Feature Flags: Check Railway dashboard for current settings"
echo ""
echo "Next Steps:"
echo "1. Test with valid JWT tokens (authenticated requests)"
echo "2. Test form ownership verification"
echo "3. Test unauthorized access attempts (should be blocked)"
echo "4. Gradually enable feature flags and test each one"
echo ""

