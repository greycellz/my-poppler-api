#!/bin/bash

# Phase 1 Security Testing with JWT Token
# Run this script locally with your own JWT token

BACKEND_URL="${RAILWAY_URL:-https://my-poppler-api-dev.up.railway.app}"

# Get JWT token from user
if [ -z "$JWT_TOKEN" ]; then
    echo "🔐 JWT Token Required"
    echo "==================="
    echo ""
    echo "Set your JWT token as an environment variable:"
    echo "  export JWT_TOKEN='your-token-here'"
    echo ""
    echo "Or run:"
    echo "  JWT_TOKEN='your-token' ./test-with-token.sh"
    echo ""
    exit 1
fi

echo "🔒 Testing with JWT Token"
echo "========================"
echo "Backend: $BACKEND_URL"
echo "Token: ${JWT_TOKEN:0:20}..." # Show first 20 chars only
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "⚠️  IMPORTANT: Replace FORM_ID and SUBMISSION_ID with your actual IDs"
echo ""

# Test 1: Get your forms
echo "=========================================="
echo "TEST 1: Get Your Forms"
echo "=========================================="
read -p "Enter your user ID (from JWT): " USER_ID
echo "Fetching forms for user: $USER_ID"
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  "$BACKEND_URL/api/forms/user/$USER_ID" \
  -H "Authorization: Bearer $JWT_TOKEN")
http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ PASS: Retrieved your forms${NC}"
    echo "$response" | grep -v "HTTP_STATUS" | jq '.' 2>/dev/null || echo "$response"
else
    echo -e "${RED}❌ FAIL: HTTP $http_code${NC}"
    echo "$response" | grep -v "HTTP_STATUS"
fi
echo ""

# Test 2: Try to delete your own form
echo "=========================================="
echo "TEST 2: Delete Your Own Form"
echo "=========================================="
read -p "Enter your form ID to test deletion: " FORM_ID
if [ -n "$FORM_ID" ]; then
    echo "⚠️  WARNING: This will DELETE the form!"
    read -p "Are you sure? (yes/no): " CONFIRM
    if [ "$CONFIRM" = "yes" ]; then
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X DELETE \
          "$BACKEND_URL/api/forms/$FORM_ID" \
          -H "Authorization: Bearer $JWT_TOKEN")
        http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
        if [ "$http_code" = "200" ]; then
            echo -e "${GREEN}✅ PASS: Deleted your own form${NC}"
        else
            echo -e "${RED}❌ FAIL: HTTP $http_code${NC}"
            echo "$response" | grep -v "HTTP_STATUS"
        fi
    else
        echo "Skipped deletion test"
    fi
else
    echo "Skipped (no form ID provided)"
fi
echo ""

# Test 3: Try to access someone else's form
echo "=========================================="
echo "TEST 3: Access Someone Else's Form (Should Fail)"
echo "=========================================="
read -p "Enter someone else's form ID: " OTHER_FORM_ID
if [ -n "$OTHER_FORM_ID" ]; then
    response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
      "$BACKEND_URL/api/forms/$OTHER_FORM_ID/submissions" \
      -H "Authorization: Bearer $JWT_TOKEN")
    http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
    if [ "$http_code" = "403" ]; then
        echo -e "${GREEN}✅ PASS: Correctly blocked access to someone else's form${NC}"
    elif [ "$http_code" = "200" ]; then
        echo -e "${RED}❌ FAIL: Should have been blocked (403) but got 200${NC}"
    else
        echo -e "${YELLOW}⚠️  Got HTTP $http_code (expected 403)${NC}"
        echo "$response" | grep -v "HTTP_STATUS"
    fi
else
    echo "Skipped (no form ID provided)"
fi
echo ""

# Test 4: Get your own form's submissions
echo "=========================================="
echo "TEST 4: Get Your Own Form's Submissions"
echo "=========================================="
read -p "Enter your form ID: " YOUR_FORM_ID
if [ -n "$YOUR_FORM_ID" ]; then
    response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
      "$BACKEND_URL/api/forms/$YOUR_FORM_ID/submissions" \
      -H "Authorization: Bearer $JWT_TOKEN")
    http_code=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ PASS: Retrieved your form's submissions${NC}"
    else
        echo -e "${RED}❌ FAIL: HTTP $http_code${NC}"
        echo "$response" | grep -v "HTTP_STATUS"
    fi
else
    echo "Skipped (no form ID provided)"
fi
echo ""

echo "=========================================="
echo "Summary"
echo "=========================================="
echo "✅ Tested authentication"
echo "✅ Tested form ownership"
echo "✅ Tested unauthorized access blocking"
echo ""
echo "Next: Test from your frontend to verify real user flows"


