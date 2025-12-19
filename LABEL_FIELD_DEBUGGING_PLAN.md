# Label Field Debugging Plan

## 🎯 **Problem Statement**

**Current Issue:**
- Label fields showing as "Untitled Field" (should show nothing/no label)
- Content not displaying in rich text format
- Need to verify end-to-end flow: Google Vision → Groq → Generate Form → Frontend Display

**Expected Behavior:**
- Label fields should have NO field name/label displayed
- Content should be in rich text format (editable with formatting toolbar)
- Should look like "untitled field" but with all the text and no input field

---

## 📋 **Testing Strategy**

### **Phase 1: Isolate First Page**
- Test with ONLY first page of `patient-forms.pdf`
- Simpler to debug, faster to iterate
- First page has clear headers: "NEW PATIENT INTAKE FORM", "PATIENT INFORMATION"

### **Phase 2: End-to-End Verification**
1. ✅ Google Vision OCR output
2. ✅ Groq API response (label field structure)
3. ✅ Generate Form API (how it processes label fields)
4. ✅ Frontend display (how it renders label fields)

---

## 🧪 **Test Plan**

### **Test 1: Google Vision OCR Output**

**Goal:** Verify OCR text extraction and spatial data

**Command:**
```bash
# Upload PDF and get first page image URL
curl -X POST https://my-poppler-api-dev.up.railway.app/api/upload \
  -F "file=@/Users/namratajha/chatterforms/tests/sample-forms/pdf/patient-forms.pdf"

# Use image URL from response, then test Vision API
curl -X POST https://my-poppler-api-dev.up.railway.app/api/test-google-vision \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://my-poppler-api-dev.up.railway.app/output/.../page-1.png"}'
```

**Expected Output:**
- OCR text: "NEW PATIENT INTAKE FORM", "PATIENT INFORMATION", etc.
- Spatial blocks with coordinates
- Verify text is extracted correctly

**What to Check:**
- ✅ OCR text contains headers
- ✅ Spatial blocks have correct coordinates
- ✅ Text blocks identified correctly

---

### **Test 2: Groq API Response (Label Fields)**

**Goal:** Verify Groq returns label fields with correct structure

**Command:**
```bash
# Test full pipeline with first page only
curl -X POST https://my-poppler-api-dev.up.railway.app/api/analyze-images \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrls": ["https://my-poppler-api-dev.up.railway.app/output/.../page-1.png"],
    "useRailwayVision": true
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "fields": [
    {
      "label": "",  // ← MUST be empty
      "type": "label",  // ← Should be "label" not "richtext"
      "richTextContent": "<h1>NEW PATIENT INTAKE FORM</h1>",  // ← Content here
      "richTextMaxHeight": 0,
      "required": false,
      "confidence": 0.98,
      "pageNumber": 1
    },
    {
      "label": "",
      "type": "label",
      "richTextContent": "<h2>PATIENT INFORMATION</h2>",
      ...
    }
  ]
}
```

**What to Check:**
- ✅ `type` is `"label"` (not `"richtext"`)
- ✅ `label` is `""` (empty string)
- ✅ `richTextContent` contains HTML (h1, h2, p tags)
- ✅ Structure matches expected format

**Potential Issues:**
- ❌ Groq still returning `type: "richtext"` → Prompt not updated correctly
- ❌ `label` field has text → Groq not following instructions
- ❌ `richTextContent` missing → Groq not populating content
- ❌ No HTML tags → Groq not formatting correctly

---

### **Test 3: Generate Form API**

**Goal:** Verify how generate-form processes label fields

**Command:**
```bash
# After field extraction, test form generation
curl -X POST https://my-poppler-api-dev.up.railway.app/api/generate-form \
  -H "Content-Type: application/json" \
  -d '{
    "formId": "test-form-id",
    "fields": [
      {
        "label": "",
        "type": "label",
        "richTextContent": "<h1>NEW PATIENT INTAKE FORM</h1>",
        "richTextMaxHeight": 0,
        "required": false,
        "confidence": 0.98,
        "pageNumber": 1
      }
    ]
  }'
```

**What to Check:**
- ✅ Form generation accepts `type: "label"`
- ✅ Field structure preserved
- ✅ No transformation of label/richTextContent
- ✅ Form saved correctly in database

**Potential Issues:**
- ❌ Generate-form rejects `type: "label"` → Type not recognized
- ❌ Field structure modified → Data loss
- ❌ Label field gets default label → "Untitled Field" added

---

### **Test 4: Frontend Display**

**Goal:** Verify frontend renders label fields correctly

**Steps:**
1. Generate form with label fields
2. Open form in dashboard
3. Inspect label field rendering

**Expected Behavior:**
- ✅ NO "Untitled Field" text displayed
- ✅ Rich text content visible (formatted)
- ✅ Rich text editor toolbar available
- ✅ Content editable

**What to Check:**
- ✅ Conditional label wrapper working (no label shown)
- ✅ RichTextField component rendering
- ✅ `richTextContent` being used
- ✅ No fallback to empty label display

**Potential Issues:**
- ❌ "Untitled Field" showing → Conditional check not working
- ❌ Content not displaying → RichTextField not receiving content
- ❌ No formatting → HTML not rendering
- ❌ Editor not showing → Component not loading

---

## 🔍 **Debugging Checklist**

### **Step 1: Verify Groq Output**
```bash
# Check Railway logs for Groq response
# Look for: "Groq API completed"
# Check the actual JSON structure returned
```

**Questions:**
- [ ] Is `type: "label"` in response?
- [ ] Is `label: ""` empty?
- [ ] Is `richTextContent` populated?
- [ ] Are HTML tags present?

### **Step 2: Verify Generate Form**
```bash
# Check form generation logs
# Verify field structure passed through
```

**Questions:**
- [ ] Does generate-form accept `type: "label"`?
- [ ] Is field structure preserved?
- [ ] Is label field saved correctly?

### **Step 3: Verify Frontend**
```javascript
// Check browser console
// Inspect form field data
console.log('Field data:', field)
```

**Questions:**
- [ ] Is `field.type === 'label'`?
- [ ] Is `field.label === ''`?
- [ ] Is `field.richTextContent` populated?
- [ ] Is conditional check working?

### **Step 4: Verify Component Rendering**
```javascript
// Check React component
// Verify RichTextField receiving props
```

**Questions:**
- [ ] Is `case 'label':` being hit?
- [ ] Is RichTextField component rendering?
- [ ] Is `content` prop being passed?
- [ ] Is component displaying content?

---

## 🐛 **Common Issues & Fixes**

### **Issue 1: "Untitled Field" Still Showing**

**Possible Causes:**
1. Frontend conditional check not working
2. Field has non-empty label value
3. Fallback logic showing default label

**Debug Steps:**
```javascript
// In PublicFormClient.tsx, add logging:
console.log('Field type:', field.type)
console.log('Field label:', field.label)
console.log('Should show label wrapper:', field.type !== 'richtext' && field.type !== 'label')
```

**Fix:**
- Verify conditional: `field.type !== 'richtext' && field.type !== 'label'`
- Check if label is actually empty (not `null` or `undefined`)
- Verify field type is exactly `'label'` (not `'Label'` or `'LABEL'`)

---

### **Issue 2: Content Not Displaying**

**Possible Causes:**
1. `richTextContent` is empty or undefined
2. RichTextField component not receiving content
3. HTML not rendering

**Debug Steps:**
```javascript
// Check field data:
console.log('richTextContent:', field.richTextContent)
console.log('richTextContent type:', typeof field.richTextContent)
console.log('richTextContent length:', field.richTextContent?.length)
```

**Fix:**
- Verify Groq populates `richTextContent`
- Check RichTextField receives `content={field.richTextContent || ''}`
- Verify HTML sanitization not removing content

---

### **Issue 3: Groq Returning Wrong Type**

**Possible Causes:**
1. Prompt not updated correctly
2. Groq not following instructions
3. Response parsing issue

**Debug Steps:**
```bash
# Check Railway logs for Groq response
# Look for the actual JSON returned
```

**Fix:**
- Verify prompt has all `richtext` → `label` changes
- Check Groq response structure
- Verify JSON parsing logic

---

## 📝 **Quick Test Script**

Create a simple test script to verify each step:

```bash
#!/bin/bash
# test-label-fields.sh

echo "🧪 Testing Label Field End-to-End Flow"
echo ""

# Step 1: Upload PDF
echo "📤 Step 1: Uploading PDF..."
UPLOAD_RESPONSE=$(curl -s -X POST https://my-poppler-api-dev.up.railway.app/api/upload \
  -F "file=@/Users/namratajha/chatterforms/tests/sample-forms/pdf/patient-forms.pdf")

UUID=$(echo $UPLOAD_RESPONSE | jq -r '.uuid')
PAGE1_URL=$(echo $UPLOAD_RESPONSE | jq -r '.images[0].url')

echo "✅ Uploaded: $UUID"
echo "📄 Page 1 URL: $PAGE1_URL"
echo ""

# Step 2: Analyze with Groq
echo "🤖 Step 2: Analyzing with Groq..."
ANALYSIS_RESPONSE=$(curl -s -X POST https://my-poppler-api-dev.up.railway.app/api/analyze-images \
  -H "Content-Type: application/json" \
  -d "{\"imageUrls\": [\"$PAGE1_URL\"], \"useRailwayVision\": true}")

echo "📊 Analysis Response:"
echo $ANALYSIS_RESPONSE | jq '.fields[] | select(.type == "label") | {type, label, richTextContent: (.richTextContent | .[0:50])}'
echo ""

# Step 3: Check label fields
LABEL_COUNT=$(echo $ANALYSIS_RESPONSE | jq '[.fields[] | select(.type == "label")] | length')
echo "✅ Found $LABEL_COUNT label fields"
echo ""

# Step 4: Verify structure
echo "🔍 Step 3: Verifying structure..."
echo $ANALYSIS_RESPONSE | jq '.fields[] | select(.type == "label") | {
  hasEmptyLabel: (.label == ""),
  hasContent: (.richTextContent != null and .richTextContent != ""),
  contentPreview: (.richTextContent | .[0:100])
}'
```

---

## 🎯 **Success Criteria**

### **Groq Output:**
- ✅ Returns `type: "label"` (not `richtext`)
- ✅ `label` field is empty string `""`
- ✅ `richTextContent` contains HTML formatted text
- ✅ At least 2-3 label fields for first page

### **Generate Form:**
- ✅ Accepts `type: "label"` without errors
- ✅ Preserves field structure
- ✅ Saves to database correctly

### **Frontend Display:**
- ✅ NO "Untitled Field" text
- ✅ Rich text content visible
- ✅ Rich text editor functional
- ✅ Content editable

---

## 🚀 **Execution Plan**

1. **Run Test 1** (Google Vision) - Verify OCR extraction
2. **Run Test 2** (Groq API) - Verify label field structure
3. **Check Railway logs** - Inspect actual Groq response
4. **Run Test 3** (Generate Form) - Verify form generation
5. **Run Test 4** (Frontend) - Verify display
6. **Fix issues** found at each step
7. **Re-test** until all criteria met

---

## 📚 **Files to Check**

### **Backend:**
- `/my-poppler-api/routes/image-analysis.js` - Groq prompt
- `/my-poppler-api/routes/generate-form.js` - Form generation logic

### **Frontend:**
- `/chatterforms/src/app/forms/[id]/PublicFormClient.tsx` - Conditional label wrapper
- `/chatterforms/src/app/dashboard/components/FormField.tsx` - Label case handling
- `/chatterforms/src/app/dashboard/components/RichTextField.tsx` - Rich text rendering

---

## ⏱️ **Time Estimate**

- **Test 1 (Vision):** 2 min
- **Test 2 (Groq):** 3 min
- **Test 3 (Generate):** 2 min
- **Test 4 (Frontend):** 3 min
- **Debugging:** 10-15 min
- **Total:** ~20-25 min

---

**Ready to execute!** 🚀

