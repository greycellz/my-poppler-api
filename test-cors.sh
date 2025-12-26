#!/bin/bash

# CORS Testing Script
# Tests CORS configuration with various origins

# Set your Railway backend URL here
BACKEND_URL="${RAILWAY_URL:-https://my-poppler-api-dev.up.railway.app}"

echo "🔍 Testing CORS Configuration"
echo "================================"
echo "Backend URL: $BACKEND_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test function
test_cors() {
    local origin=$1
    local expected=$2
    local description=$3
    
    echo "Testing: $description"
    echo "Origin: $origin"
    echo "Expected: $expected"
    echo ""
    
    # Test OPTIONS preflight request
    echo "1. OPTIONS (Preflight) Request:"
    response=$(curl -s -i -X OPTIONS "$BACKEND_URL/api/forms/test-form-id" \
        -H "Origin: $origin" \
        -H "Access-Control-Request-Method: GET" \
        -H "Access-Control-Request-Headers: Authorization,Content-Type")
    
    if echo "$response" | grep -q "Access-Control-Allow-Origin"; then
        allowed_origin=$(echo "$response" | grep -i "Access-Control-Allow-Origin" | head -1)
        echo -e "${GREEN}✅ CORS headers present${NC}"
        echo "   $allowed_origin"
    else
        echo -e "${RED}❌ No CORS headers${NC}"
    fi
    
    echo ""
    
    # Test actual GET request
    echo "2. GET Request:"
    response=$(curl -s -i -X GET "$BACKEND_URL/api/forms/test-form-id" \
        -H "Origin: $origin" \
        -H "Authorization: Bearer test-token")
    
    if echo "$response" | grep -q "Access-Control-Allow-Origin"; then
        allowed_origin=$(echo "$response" | grep -i "Access-Control-Allow-Origin" | head -1)
        echo -e "${GREEN}✅ CORS headers present${NC}"
        echo "   $allowed_origin"
        
        # Check if origin matches
        if echo "$allowed_origin" | grep -q "$origin"; then
            echo -e "${GREEN}   ✅ Origin matches!${NC}"
        elif echo "$allowed_origin" | grep -q "\*"; then
            echo -e "${YELLOW}   ⚠️  Wildcard CORS (permissive mode)${NC}"
        else
            echo -e "${RED}   ❌ Origin mismatch!${NC}"
        fi
    else
        echo -e "${RED}❌ No CORS headers${NC}"
    fi
    
    echo ""
    echo "---"
    echo ""
}

# Test cases

echo "=========================================="
echo "TEST 1: Allowed Origin - chatterforms.com"
echo "=========================================="
test_cors "https://chatterforms.com" "allowed" "Production domain"

echo "=========================================="
echo "TEST 2: Allowed Origin - www.chatterforms.com"
echo "=========================================="
test_cors "https://www.chatterforms.com" "allowed" "WWW production domain"

echo "=========================================="
echo "TEST 3: Allowed Origin - localhost:3000"
echo "=========================================="
test_cors "http://localhost:3000" "allowed" "Local development"

echo "=========================================="
echo "TEST 4: Disallowed Origin - malicious.com"
echo "=========================================="
test_cors "https://malicious.com" "blocked" "Malicious domain (should be blocked in strict mode)"

echo "=========================================="
echo "TEST 5: Disallowed Origin - random-origin.com"
echo "=========================================="
test_cors "https://random-origin.com" "blocked" "Random domain (should be blocked in strict mode)"

echo "=========================================="
echo "TEST 6: No Origin Header"
echo "=========================================="
echo "Testing request without Origin header..."
response=$(curl -s -i -X GET "$BACKEND_URL/api/forms/test-form-id")
if echo "$response" | grep -q "Access-Control-Allow-Origin"; then
    echo -e "${YELLOW}⚠️  CORS headers present even without Origin${NC}"
else
    echo -e "${GREEN}✅ No CORS headers (expected)${NC}"
fi

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "With ENABLE_STRICT_CORS=true:"
echo "  - Allowed origins should return specific origin in header"
echo "  - Disallowed origins should NOT return CORS headers"
echo ""
echo "With ENABLE_STRICT_CORS=false:"
echo "  - Allowed origins return specific origin"
echo "  - Disallowed origins fall back to wildcard (*)"
echo ""


