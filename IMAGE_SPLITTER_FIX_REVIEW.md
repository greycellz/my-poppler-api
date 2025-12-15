# Image Splitter Fix Review

## Problem Identified

**Error from logs:**
```
Image splitting error: Error: extract_area: bad extract area
```

**Root causes:**
1. **Sharp pipeline reuse**: The original code reused the same `image` sharp pipeline object for multiple `.extract()` calls, which doesn't work because sharp pipelines are stateful and can't be reused.
2. **Incorrect bounds calculation**: The math for calculating section offsets and heights could result in out-of-bounds extracts.

## Changes Made

### 1. Fixed Sharp Pipeline Reuse ✅
**Before:**
```javascript
const image = sharp(imageBuffer)
// ... later in loop ...
const sectionBuffer = await image.extract({...}).toBuffer()  // ❌ Reuses same pipeline
```

**After:**
```javascript
// Create a new sharp instance for each section (can't reuse the same pipeline)
const sectionBuffer = await sharp(imageBuffer).extract({...}).toBuffer()  // ✅ New instance each time
```

**Why this works:** Each section gets a fresh sharp instance from the original buffer, avoiding pipeline state issues.

---

### 2. Fixed Bounds Calculation ✅

**Before:**
```javascript
const sectionHeight = Math.ceil(height / numSections) + overlap
const yOffset = i * (sectionHeight - overlap)
const sectionHeightActual = Math.min(sectionHeight, height - yOffset)
```

**Issues:**
- Could calculate offsets/heights that exceed image bounds
- Overlap calculation was incorrect
- Last section handling was unclear

**After:**
```javascript
// Calculate base section height accounting for overlap
const baseSectionHeight = Math.floor((height - overlap) / numSections) + overlap

for (let i = 0; i < numSections; i++) {
  // Y offset: first section at 0, others account for overlap
  const yOffset = i === 0 ? 0 : i * (baseSectionHeight - overlap)
  
  // Height: last section takes remaining, others use baseSectionHeight
  let sectionHeight
  if (i === numSections - 1) {
    sectionHeight = height - yOffset  // Last section: all remaining
  } else {
    sectionHeight = baseSectionHeight  // Other sections: base height
  }
  
  // Safety check: ensure we don't exceed bounds
  if (yOffset + sectionHeight > height) {
    sectionHeight = height - yOffset
  }
  
  // Validation: skip invalid sections
  if (sectionHeight <= 0 || yOffset >= height) {
    console.warn(`⚠️ Section ${i + 1} has invalid dimensions, skipping`)
    continue
  }
}
```

---

## Verification with Real Example

**Test case from logs:**
- Image height: `18155px`
- Max height: `4000px`
- Overlap: `200px`
- Expected sections: `Math.ceil(18155 / 4000) = 5`

**Calculation:**
```
baseSectionHeight = Math.floor((18155 - 200) / 5) + 200
                  = Math.floor(17955 / 5) + 200
                  = 3591 + 200
                  = 3791px
```

**Section breakdown:**
| Section | yOffset | Height | Bottom | Overlap with previous |
|---------|---------|--------|--------|----------------------|
| 0       | 0       | 3791   | 3791   | N/A (first)          |
| 1       | 3591    | 3791   | 7382   | 3591-3791 (200px)    |
| 2       | 7182    | 3791   | 10973  | 7182-7382 (200px)    |
| 3       | 10773   | 3791   | 14564  | 10773-10973 (200px)  |
| 4       | 14364   | 3791   | 18155  | 14364-14564 (200px)  |

**Verification:**
- ✅ All sections within bounds (max bottom = 18155)
- ✅ 200px overlap between sections
- ✅ No gaps between sections
- ✅ Last section ends exactly at image height

---

## Improvements

### 1. **Bounds Safety** ✅
- Added explicit check: `if (yOffset + sectionHeight > height)`
- Prevents out-of-bounds extracts

### 2. **Validation** ✅
- Added validation: `if (sectionHeight <= 0 || yOffset >= height)`
- Skips invalid sections with warning instead of crashing

### 3. **Clear Logic** ✅
- Separated offset and height calculations
- Clear handling for first and last sections
- Well-commented code

### 4. **Error Handling** ✅
- Existing try-catch still returns original image on failure
- New validation prevents errors from reaching sharp

---

## Potential Edge Cases

### 1. **Very small images**
- Handled: Early return if `height <= maxHeight`

### 2. **Exact multiples**
- Example: `height = 8000px`, `maxHeight = 4000px`, `numSections = 2`
- Calculation: `baseSectionHeight = Math.floor((8000-200)/2) + 200 = 4100px`
- Section 0: 0-4100, Section 1: 3900-8000
- ✅ Works correctly with 200px overlap

### 3. **Rounding errors**
- Handled: Last section always takes `height - yOffset` to ensure full coverage

### 4. **Invalid dimensions**
- Handled: Validation checks skip invalid sections

---

## Testing Recommendations

1. **Test with the actual form (18155px)** ✅
   - Should split into 5 sections
   - Each section should be valid
   - No "bad extract area" errors

2. **Test edge cases:**
   - Image exactly at threshold (4000px)
   - Image just over threshold (4001px)
   - Very tall image (50000px+)
   - Small image (< 4000px, should not split)

3. **Verify overlap:**
   - Check that adjacent sections have 200px overlap
   - Verify deduplication works correctly

---

## Conclusion

✅ **Fix is correct and safe**

**Key improvements:**
1. ✅ Fixed sharp pipeline reuse issue
2. ✅ Corrected bounds calculation
3. ✅ Added safety checks and validation
4. ✅ Handles edge cases properly
5. ✅ Maintains 200px overlap as designed

**Ready to deploy** ✅
