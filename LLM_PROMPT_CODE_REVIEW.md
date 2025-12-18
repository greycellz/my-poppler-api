# LLM Prompt Code Review - Richtext + Regular Fields

## 🎯 **Objective**
Ensure the LLM prompt correctly extracts BOTH:
1. **Richtext fields** (titles, headers, instructions) - NEW
2. **Regular input fields** (text, email, phone, etc.) - EXISTING

---

## ✅ **What's Correct**

### **1. Task Definition (Lines 417-423)**
```javascript
**YOUR TASK**: Analyze the text AND spatial data to extract:
1. **Input fields** (text, email, phone, checkboxes, etc.) - for data collection
2. **Richtext fields** (titles, section headers, instructions, legal text) - for display/organization

IMPORTANT: Do NOT skip titles, headers, or instructions.
```
✅ **Clear**: Both field types explicitly mentioned
✅ **Emphasis**: Warns not to skip richtext elements

---

### **2. Spatial Classification Rules (Lines 335-371)**
Provides 7 clear rules with specific criteria and outputs:

| Rule | Triggers | Output |
|------|----------|--------|
| **Form Titles** | Height >25px, y<200, no colon | `<h1>` richtext |
| **Section Headers** | Height 18-25px, semantic meaning | `<h2>` richtext |
| **Instructions** | Height >40px OR length >100 | `<p>` richtext |
| **Field Labels** | Ends with ":", height 12-20px | Input field label |
| **Checkboxes** | Contains ☐ | Input field options |
| **Horizontal Groups** | Same y-coord (±10px) | Separate fields |
| **Numbered Fields** | Starts with number | Keep number in label |

✅ **Comprehensive**: Covers both richtext and input field detection
✅ **Measurable**: Uses quantifiable metrics (height, y-coord)

---

### **3. Richtext Examples (Lines 372-405)**
Three concrete examples with actual spatial data:

```javascript
Example 1 - Form Title:
{
  "label": "Form Title",
  "type": "richtext",
  "richTextContent": "<h1>PATIENT INTAKE FORM</h1>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.98,
  "pageNumber": 1
}
```

✅ **Shows all required fields**: `richTextContent`, `richTextMaxHeight`
✅ **Matches actual blocks**: References real spatial data (y:225, h:30)
✅ **Multiple types**: h1 (title), h2 (header), p (disclaimer)

---

### **4. JSON Structure (Lines 488-526)**
Now includes BOTH field types:

**FOR INPUT FIELDS:**
```json
{
  "label": "First Name",
  "type": "text",
  "required": false,
  "placeholder": "",
  "options": [],
  "allowOther": false,
  "confidence": 0.97,
  "pageNumber": 1
}
```

**FOR RICHTEXT FIELDS:**
```json
{
  "label": "Form Title",
  "type": "richtext",
  "richTextContent": "<h1>Title</h1>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.95,
  "pageNumber": 1
}
```

✅ **Critical fix**: "richtext" is now included as a valid type
✅ **Shows both**: Separate structures for each field type
✅ **Field-specific**: Input fields have `options`, richtext has `richTextContent`

---

### **5. Complete Mixed Example (Lines 534-585)**
Shows BOTH field types in visual order:

```javascript
Given spatial data:
- Block 1: "PATIENT INTAKE FORM" (y:225, h:30)
- Block 3: "PATIENT DETAILS" (y:433, h:23)
- Block 4: "First Name:" (y:505, h:21)

Output (mixed):
[
  {"type": "richtext", "richTextContent": "<h1>PATIENT INTAKE FORM</h1>", ...},
  {"type": "richtext", "richTextContent": "<h2>PATIENT DETAILS</h2>", ...},
  {"type": "text", "label": "First Name", ...}
]
```

✅ **Shows interleaving**: Richtext and input fields mixed based on position
✅ **Visual ordering**: Fields sorted by y-coordinate (top to bottom)
✅ **Both types**: Demonstrates how they work together

---

### **6. User Message (Lines 554-563)**
```javascript
let groqUserMessage = `Analyze this OCR text and extract BOTH:
1. Richtext fields (titles, section headers, instructions, legal text)
2. Input fields (text, email, phone, checkboxes, etc.)

Extract ALL elements in visual order (top to bottom based on y-coordinates).
Include both richtext fields for display AND input fields for data collection.`
```

✅ **Reinforces dual extraction**: Mentions both types again
✅ **Visual ordering**: Reminds to use y-coordinates
✅ **Inclusive language**: "ALL elements", "BOTH"

---

### **7. Existing Field Rules Preserved (Lines 425-520)**
All existing rules for input fields remain intact:
- ✅ No deduplication logic
- ✅ Conditional questions handling
- ✅ Options grouping (checkboxes, radio)
- ✅ allowOther logic
- ✅ Row-based structures (tables)
- ✅ Label disambiguation
- ✅ Field type inference rules

---

## ⚠️ **Potential Issues**

### **1. Y-Coordinate Ordering Assumption**
```javascript
"OUTPUT ORDER": Create fields in VISUAL ORDER (sorted by y-coordinate)
```

**Issue**: Multi-column layouts might have fields with similar y-coords but different x-coords.

**Example**: 
```
"First Name:" (x:76, y:505)  "Last Name:" (x:564, y:506)
```

These are on the same visual row but have slightly different y-coords (505 vs 506).

**Current behavior**: LLM will likely order them correctly (First Name before Last Name) since they're within 10px.

**Recommendation**: ✅ OK for now, but monitor in testing.

---

### **2. Richtext Label Ambiguity**
```json
{
  "label": "Form Title|Section Header|Disclaimer|Instructions",
  ...
}
```

**Issue**: Pipe-separated options might confuse LLM about what label to use.

**Better**: Provide specific label guidance:
- Form titles → "Form Title"
- Section headers → "Section Header" or the actual header text
- Disclaimers → "Disclaimer"
- Instructions → "Instructions"

**Current examples**: ✅ Show specific labels ("Form Title", "Section Header"), so should be OK.

---

### **3. Height Thresholds May Vary**
```
1. Form Titles: Height >25px
2. Section Headers: Height 18-25px
3. Field Labels: Height 12-20px
```

**Issue**: Different PDFs/forms may have different font sizes:
- W-9 (government form): Block 1 height=82px (very large!)
- Patient Intake: Block 1 height=30px
- Heinz: Block 1 height=20px

**Current behavior**: Rules say ">25px" but Patient Intake title is 30px (OK) and Heinz is 20px (would miss it).

**Mitigation**: ✅ Spatial context shows the LLM the ACTUAL heights, so it can adapt. Rules are guidelines, not absolute.

**Recommendation**: ✅ OK - LLM has context to adapt.

---

### **4. Instructions with Colons**
```
"Disclaimer: Thank you for your interest..."
```

**Issue**: Rule says "No colon at end" for headers, but "Disclaimer:" has a colon at the END of "Disclaimer".

**Current behavior**: Height rule (>40px) should catch this as instructions anyway.

**Recommendation**: ✅ OK - Multiple detection paths ensure capture.

---

## 🧪 **Expected Behavior on Test Forms**

### **Test 1: Patient Intake Form**

**Spatial Data:**
```
Block 1: "PATIENT INTAKE FORM" (y:225, h:30)
Block 2: "Disclaimer: ..." (y:302, h:89)
Block 4: "PATIENT DETAILS" (y:433, h:23)
Block 3: "First Name:" (y:505, h:21)
Block 5: "Last Name:" (y:506, h:19)
```

**Expected Output:**
1. ✅ Richtext: "PATIENT INTAKE FORM" → `<h1>`
2. ✅ Richtext: "Disclaimer: ..." → `<p>`
3. ✅ Richtext: "PATIENT DETAILS" → `<h2>`
4. ✅ Input: "First Name" → type: "text"
5. ✅ Input: "Last Name" → type: "text"
... (20+ more input fields)

**Total Expected**: ~3 richtext + ~24 input = **~27 fields**

---

### **Test 2: W-9 Form**

**Spatial Data:**
```
Block 1: "Form W-9 (Rev. March 2024)..." (y:72, h:82)
Block 2: "Internal Revenue Service" (y:159, h:10)
Block 3: "Request for Taxpayer Identification..." (y:82, h:82)
Block 6: "1 Name of entity/individual..." (y:206, h:29)
```

**Expected Output:**
1. ✅ Richtext: "Form W-9 (Rev. March 2024)" → `<h1>` (h:82 > 25)
2. ✅ Richtext: "Request for Taxpayer Identification..." → `<h1>` (h:82 > 25)
3. ⚠️ Maybe richtext: "Internal Revenue Service" (h:10 < 18, might skip)
4. ✅ Input: "1 Name of entity/individual" → type: "text"
... (10+ more input fields)

**Total Expected**: ~2-3 richtext + ~14 input = **~16-17 fields**

---

### **Test 3: Heinz Intake Questionnaire**

**Spatial Data:**
```
Block 1: "INTAKE QUESTIONNAIRE" (y:81, h:20)
Block 2: "This questionnaire will help..." (y:142, h:47)
Block 3: "Contact Information" (y:234, h:16)
Block 4: "Name: Anton Troynikov" (y:298, h:16)
```

**Expected Output:**
1. ⚠️ Maybe richtext: "INTAKE QUESTIONNAIRE" (h:20 < 25, but y:81 < 200, all caps, pattern match → should detect via spatial rules)
2. ✅ Richtext: "This questionnaire will help..." → `<p>` (h:47 > 40)
3. ⚠️ Maybe richtext: "Contact Information" (h:16 < 18, but pattern match, title case → spatial rules should detect)
4. ✅ Input: "Name" → type: "text" (has colon, so it's a field label)
... (18+ more input fields)

**Total Expected**: ~2-3 richtext + ~21 input = **~23-24 fields**

---

## 🎯 **Code Review Summary**

| Aspect | Status | Notes |
|--------|--------|-------|
| **Task Definition** | ✅ Clear | Both types explicitly mentioned |
| **Spatial Rules** | ✅ Good | 7 rules cover all cases |
| **Richtext Examples** | ✅ Complete | 3 concrete examples with spatial data |
| **JSON Structure** | ✅ Fixed | "richtext" now included as valid type |
| **Mixed Example** | ✅ Added | Shows both types interleaved |
| **User Message** | ✅ Updated | Reinforces dual extraction |
| **Input Field Rules** | ✅ Preserved | All existing logic intact |
| **Y-Ordering** | ⚠️ Monitor | May need x-coord consideration later |
| **Height Thresholds** | ⚠️ Monitor | LLM has context to adapt |
| **Colon Handling** | ✅ OK | Multiple detection paths |

---

## ✅ **Final Verdict**

**Code is READY for testing.**

**Strengths:**
1. ✅ Both field types clearly defined
2. ✅ Multiple examples showing correct output
3. ✅ Spatial data provides rich context for LLM
4. ✅ Existing input field logic preserved
5. ✅ JSON structure includes all required fields

**Minor Concerns:**
1. ⚠️ Height thresholds may need adaptation per form
2. ⚠️ Y-ordering may need x-coord refinement for multi-column

**Mitigation:**
- LLM has full spatial context (x, y, w, h) to make smart decisions
- Multiple detection paths (height, position, pattern, formatting)
- Concrete examples ground the LLM's understanding

**Recommendation:**
✅ **Deploy and test** on all 3 forms (Patient Intake, W-9, Heinz)
✅ **Monitor** richtext field detection rates
✅ **Iterate** on height thresholds if needed

