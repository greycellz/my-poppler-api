#!/bin/bash
# Quick test script for label field debugging

set -e

echo "🧪 Testing Label Field End-to-End Flow"
echo "======================================"
echo ""

# Step 1: Upload PDF
echo "📤 Step 1: Uploading PDF (first page only)..."
UPLOAD_RESPONSE=$(curl -s -X POST https://my-poppler-api-dev.up.railway.app/api/upload \
  -F "file=@/Users/namratajha/chatterforms/tests/sample-forms/pdf/patient-forms.pdf")

UUID=$(echo $UPLOAD_RESPONSE | jq -r '.uuid')
PAGE1_URL=$(echo $UPLOAD_RESPONSE | jq -r '.images[0].url')

if [ "$UUID" == "null" ] || [ -z "$PAGE1_URL" ]; then
  echo "❌ Upload failed!"
  echo "$UPLOAD_RESPONSE"
  exit 1
fi

echo "✅ Uploaded: $UUID"
echo "📄 Page 1 URL: $PAGE1_URL"
echo ""

# Step 2: Analyze with Groq
echo "🤖 Step 2: Analyzing with Groq API..."
ANALYSIS_RESPONSE=$(curl -s -X POST https://my-poppler-api-dev.up.railway.app/api/analyze-images \
  -H "Content-Type: application/json" \
  -d "{\"imageUrls\": [\"$PAGE1_URL\"], \"useRailwayVision\": true}")

# Check if analysis succeeded
SUCCESS=$(echo $ANALYSIS_RESPONSE | jq -r '.success')
if [ "$SUCCESS" != "true" ]; then
  echo "❌ Analysis failed!"
  echo "$ANALYSIS_RESPONSE" | jq '.'
  exit 1
fi

echo "✅ Analysis successful"
echo ""

# Step 3: Extract label fields
echo "🔍 Step 3: Checking label fields..."
LABEL_FIELDS=$(echo $ANALYSIS_RESPONSE | jq '[.fields[] | select(.type == "label")]')
LABEL_COUNT=$(echo $LABEL_FIELDS | jq 'length')

echo "📊 Found $LABEL_COUNT label fields"
echo ""

# Step 4: Verify structure of first 3 label fields
echo "📋 Step 4: Verifying structure (first 3 label fields)..."
echo "$LABEL_FIELDS" | jq '.[0:3] | .[] | {
  type: .type,
  label: .label,
  labelIsEmpty: (.label == ""),
  hasRichTextContent: (.richTextContent != null and .richTextContent != ""),
  richTextContentPreview: (.richTextContent | .[0:100]),
  richTextMaxHeight: .richTextMaxHeight,
  required: .required,
  confidence: .confidence,
  pageNumber: .pageNumber
}'
echo ""

# Step 5: Check for issues
echo "🔍 Step 5: Checking for issues..."
echo ""

# Check if any label fields have non-empty label
NON_EMPTY_LABELS=$(echo $LABEL_FIELDS | jq '[.[] | select(.label != "")] | length')
if [ "$NON_EMPTY_LABELS" -gt 0 ]; then
  echo "⚠️  WARNING: $NON_EMPTY_LABELS label fields have non-empty label field!"
  echo "$LABEL_FIELDS" | jq '.[] | select(.label != "") | {type, label, richTextContent: (.richTextContent | .[0:50])}'
else
  echo "✅ All label fields have empty label field"
fi
echo ""

# Check if any label fields are missing richTextContent
MISSING_CONTENT=$(echo $LABEL_FIELDS | jq '[.[] | select(.richTextContent == null or .richTextContent == "")] | length')
if [ "$MISSING_CONTENT" -gt 0 ]; then
  echo "⚠️  WARNING: $MISSING_CONTENT label fields are missing richTextContent!"
  echo "$LABEL_FIELDS" | jq '.[] | select(.richTextContent == null or .richTextContent == "") | {type, label, richTextContent}'
else
  echo "✅ All label fields have richTextContent"
fi
echo ""

# Check if any fields are still richtext
RICHTEXT_COUNT=$(echo $ANALYSIS_RESPONSE | jq '[.fields[] | select(.type == "richtext")] | length')
if [ "$RICHTEXT_COUNT" -gt 0 ]; then
  echo "⚠️  WARNING: Found $RICHTEXT_COUNT richtext fields (should be label)!"
  echo "$ANALYSIS_RESPONSE" | jq '[.fields[] | select(.type == "richtext")] | .[0:2] | .[] | {type, label, richTextContent: (.richTextContent | .[0:50])}'
else
  echo "✅ No richtext fields found (all converted to label)"
fi
echo ""

# Summary
echo "📊 Summary:"
echo "  - Total fields: $(echo $ANALYSIS_RESPONSE | jq '.fields | length')"
echo "  - Label fields: $LABEL_COUNT"
echo "  - Input fields: $(echo $ANALYSIS_RESPONSE | jq '[.fields[] | select(.type != "label")] | length')"
echo ""

# Save full response for inspection
OUTPUT_FILE="label-fields-test-$(date +%Y%m%d-%H%M%S).json"
echo "$ANALYSIS_RESPONSE" | jq '.' > "$OUTPUT_FILE"
echo "💾 Full response saved to: $OUTPUT_FILE"
echo ""

echo "✅ Test complete!"

