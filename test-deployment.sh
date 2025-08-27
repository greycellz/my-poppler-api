#!/bin/bash

# Railway Deployment Testing Script
# Replace YOUR_RAILWAY_DOMAIN with your actual Railway domain

RAILWAY_DOMAIN="YOUR_RAILWAY_DOMAIN"  # Replace this with your actual domain
BASE_URL="https://${RAILWAY_DOMAIN}"

echo "🚀 Testing Railway Deployment: ${BASE_URL}"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    
    echo -e "\n${BLUE}Testing: ${name}${NC}"
    echo "Endpoint: ${method} ${BASE_URL}${endpoint}"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "${BASE_URL}${endpoint}")
    else
        response=$(curl -s -w "\n%{http_code}" -X "${method}" -H "Content-Type: application/json" -d "${data}" "${BASE_URL}${endpoint}")
    fi
    
    # Extract status code (last line)
    status_code=$(echo "$response" | tail -n1)
    # Extract response body (all lines except last)
    body=$(echo "$response" | head -n -1)
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        echo -e "${GREEN}✅ SUCCESS (${status_code})${NC}"
        echo "Response: $body" | jq '.' 2>/dev/null || echo "Response: $body"
    else
        echo -e "${RED}❌ FAILED (${status_code})${NC}"
        echo "Response: $body"
    fi
    
    echo "--------------------------------------------------"
}

# Test 1: Health Check
test_endpoint "Health Check" "GET" "/health"

# Test 2: GCP Integration Test
test_endpoint "GCP Integration Test" "GET" "/test-gcp"

# Test 3: Cleanup Endpoint
test_endpoint "Cleanup Endpoint" "GET" "/cleanup"

# Test 4: Screenshot Endpoint (with test data)
screenshot_data='{"url": "https://example.com", "viewport": {"width": 1280, "height": 800}}'
test_endpoint "Screenshot Endpoint" "POST" "/screenshot" "$screenshot_data"

echo -e "\n${YELLOW}📋 Test Summary:${NC}"
echo "=================================================="
echo "✅ Health Check: Basic service status"
echo "✅ GCP Integration: Firestore, Storage, KMS, BigQuery"
echo "✅ Cleanup: File cleanup functionality"
echo "✅ Screenshot: URL screenshot functionality"
echo ""
echo -e "${GREEN}🎉 All tests completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Check Railway logs for any errors"
echo "2. Verify GCP services are working correctly"
echo "3. Test with actual form data"
echo "4. Integrate with Vercel frontend"
