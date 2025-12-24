#!/bin/bash

# Quick CORS Test Commands
BACKEND_URL="https://my-poppler-api-dev.up.railway.app"

echo "🔍 Quick CORS Tests"
echo "=================="
echo ""

# Test 1: Allowed origin (chatterforms.com)
echo "TEST 1: Allowed Origin - chatterforms.com"
echo "-------------------------------------------"
curl -i -X OPTIONS "$BACKEND_URL/api/forms/test" \
  -H "Origin: https://chatterforms.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  2>&1 | grep -i "access-control"
echo ""

# Test 2: Allowed origin (localhost)
echo "TEST 2: Allowed Origin - localhost:3000"
echo "-------------------------------------------"
curl -i -X OPTIONS "$BACKEND_URL/api/forms/test" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  2>&1 | grep -i "access-control"
echo ""

# Test 3: Disallowed origin (should be blocked in strict mode)
echo "TEST 3: Disallowed Origin - malicious.com"
echo "-------------------------------------------"
curl -i -X OPTIONS "$BACKEND_URL/api/forms/test" \
  -H "Origin: https://malicious.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  2>&1 | grep -i "access-control"
echo ""

echo "✅ Expected Results:"
echo "  - Test 1 & 2: Should show 'Access-Control-Allow-Origin' header"
echo "  - Test 3: Should NOT show CORS headers (blocked in strict mode)"
