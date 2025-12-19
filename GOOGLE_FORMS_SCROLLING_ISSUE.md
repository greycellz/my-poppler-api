# Google Forms Scrolling Issue Analysis

## Problem

Testing with Google Forms URL shows:
- ✅ Pipeline is working (screenshots captured, OCR working)
- ❌ **Duplication**: Same fields repeated multiple times
- ❌ **Missing fields**: Only seeing first few fields (Email), missing most of the form
- ✅ 6 screenshots captured, but content appears to be duplicated across screenshots

## Root Cause Analysis

### Issue 1: Scrolling Logic May Not Work for Google Forms

**Current scrolling logic** (lines 166-183):
```javascript
await page.evaluate(() => {
  return new Promise((resolve) => {
    let totalHeight = 0
    const distance = 100
    const timer = setInterval(() => {
      const scrollHeight = document.body.scrollHeight
      window.scrollBy(0, distance)
      totalHeight += distance

      if (totalHeight >= scrollHeight) {
        clearInterval(timer)
        window.scrollTo(0, 0)
        setTimeout(() => resolve(), 1000)
      }
    }, 100)
  })
})
```

**Problems**:
1. Uses `scrollBy` which increments, but checks against `scrollHeight` which may change as content loads
2. Google Forms uses lazy loading - content loads as you scroll
3. The check `totalHeight >= scrollHeight` might trigger before all content is loaded
4. After scrolling to load, it scrolls back to top, then later scrolls to each position - but content might not be loaded at those positions

### Issue 2: Insufficient Wait Time at Each Scroll Position

**Current logic** (lines 247-253):
```javascript
// Scroll to position
await page.evaluate((y) => {
  window.scrollTo(0, y)
}, scrollY)

// Wait for scroll to settle
await new Promise(resolve => setTimeout(resolve, scrollDelay)) // 500ms
```

**Problems**:
1. Google Forms might need more than 500ms to load content at each scroll position
2. No check to ensure content is actually loaded
3. Should wait for network idle or specific elements

### Issue 3: Overlap Calculation

**Current overlap logic** (lines 234-243):
```javascript
let scrollY
if (i === 0) {
  scrollY = 0
} else {
  scrollY = (i * viewportHeight) - overlap
  if (scrollY < 0) scrollY = 0
}
```

**Example with viewportHeight=800, overlap=50**:
- Page 1: scrollY = 0
- Page 2: scrollY = (1 * 800) - 50 = 750px
- Page 3: scrollY = (2 * 800) - 50 = 1550px

This looks correct, but if content isn't loaded at those positions, we'll capture the same content.

## Recommended Fixes

### Fix 1: Improve Initial Scrolling to Load Content

```javascript
// Better scrolling logic that waits for content to load
await page.evaluate(async () => {
  return new Promise((resolve) => {
    let lastHeight = 0
    let attempts = 0
    const maxAttempts = 50 // Prevent infinite loop
    
    const scrollAndCheck = () => {
      window.scrollTo(0, document.body.scrollHeight)
      
      setTimeout(() => {
        const newHeight = document.body.scrollHeight
        if (newHeight === lastHeight || attempts >= maxAttempts) {
          // Scroll back to top
          window.scrollTo(0, 0)
          setTimeout(() => resolve(), 1000)
        } else {
          lastHeight = newHeight
          attempts++
          scrollAndCheck()
        }
      }, 1000) // Wait 1 second for content to load
    }
    
    scrollAndCheck()
  })
})
```

### Fix 2: Wait for Content at Each Scroll Position

```javascript
// Scroll to position
await page.evaluate((y) => {
  window.scrollTo(0, y)
}, scrollY)

// Wait for network idle and content to load
await page.waitForTimeout(scrollDelay) // Initial wait
await page.evaluate(() => {
  return new Promise((resolve) => {
    // Wait for images to load
    const images = document.querySelectorAll('img')
    let loaded = 0
    const total = images.length
    
    if (total === 0) {
      setTimeout(resolve, 500)
      return
    }
    
    images.forEach(img => {
      if (img.complete) {
        loaded++
        if (loaded === total) resolve()
      } else {
        img.onload = () => {
          loaded++
          if (loaded === total) resolve()
        }
        img.onerror = () => {
          loaded++
          if (loaded === total) resolve()
        }
      }
    })
    
    // Timeout after 2 seconds
    setTimeout(resolve, 2000)
  })
})
```

### Fix 3: Increase Wait Times for Google Forms

Google Forms specifically needs more time:
- Increase `waitTime` from 4000ms to 6000ms
- Increase `scrollDelay` from 500ms to 1000ms
- Add additional wait after scrolling to each position

### Fix 4: Add Debug Logging

Add logging to verify scroll positions and content:
```javascript
// After scrolling to position, check what's visible
const visibleContent = await page.evaluate(() => {
  const form = document.querySelector('form')
  if (form) {
    const inputs = form.querySelectorAll('input, textarea, select')
    return {
      inputCount: inputs.length,
      firstInputLabel: inputs[0]?.closest('.freebirdFormviewerViewItemsItemItem')?.textContent?.substring(0, 50) || 'none',
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight
    }
  }
  return null
})
console.log(`📊 [DEBUG] Visible content at scroll ${scrollY}:`, visibleContent)
```

## Test Script

Created `test/test-google-forms-screenshot.js` to:
1. Test screenshot capture
2. Test OCR from each screenshot individually
3. Test full pipeline
4. Identify duplication issues
5. Compare field counts

## Next Steps

1. Run the test script: `node test/test-google-forms-screenshot.js`
2. Review the output to see:
   - How many fields are in each screenshot
   - If screenshots are capturing different content
   - Where duplication is happening
3. Apply fixes based on test results
4. Re-test to verify fixes
