# Email Normalization Impact Analysis

## Current Situation

We removed `.normalizeEmail()` from express-validator because it was **mutating the request body**, causing:
- User enters: `jha.abhishek@gmail.com`
- After `.normalizeEmail()`: `jhaabhishek@gmail.com` (dots removed)
- Stored email: `jhaabhishek@gmail.com` (confusing for users)
- Display shows: `jhaabhishek@gmail.com` (not what user entered)

## express-validator's `.normalizeEmail()` Behavior

**What it does:**
- Lowercases the email
- **Mutates `req.body.email`** (this is the problem)
- For Gmail:
  - Removes dots from local part
  - Removes +aliases (e.g., `user+test@gmail.com` → `user@gmail.com`)
  - Converts `@googlemail.com` → `@gmail.com`
- For other providers: Just lowercases

**Source:** Uses `validator` library's `normalizeEmail()` under the hood

## Our Custom `normalizeEmailForLookup()` Function

**What it does:**
- Lowercases and trims
- **Does NOT mutate the original email**
- For Gmail:
  - Removes dots from local part
  - Removes +aliases
- For non-Gmail: Just lowercases

**Key Difference:** Only normalizes for duplicate checking/lookups, preserves original for storage/display

## Comparison Table

| Aspect | express-validator `.normalizeEmail()` | Our Custom Function |
|--------|--------------------------------------|---------------------|
| **Mutates request body** | ✅ Yes (changes `req.body.email`) | ❌ No (original preserved) |
| **Preserves user input** | ❌ No | ✅ Yes |
| **Display email** | Normalized (dots removed) | Exact user input |
| **Duplicate checking** | ✅ Works (via normalized storage) | ✅ Works (via normalized field) |
| **Login flexibility** | ✅ Works (stored normalized) | ✅ Works (checks both) |
| **Standard library** | ✅ Yes (express-validator) | ❌ No (custom) |
| **Maintenance** | ✅ Maintained by library | ⚠️ We maintain |
| **Gmail dot handling** | ✅ Yes | ✅ Yes |
| **Gmail +alias handling** | ✅ Yes | ✅ Yes |
| **@googlemail.com handling** | ✅ Yes | ❌ No (not implemented) |

## Impact Analysis: Using express-validator's `.normalizeEmail()`

### Option 1: Use `.normalizeEmail()` and Accept Normalized Display

**Approach:**
```javascript
body('email')
  .isEmail()
  .normalizeEmail()  // Mutates req.body.email
  .withMessage('Please provide a valid email address')
```

**Pros:**
- ✅ Uses standard library (express-validator)
- ✅ Well-tested and maintained
- ✅ Handles `@googlemail.com` → `@gmail.com`
- ✅ Simpler code (no custom function)

**Cons:**
- ❌ **User sees normalized email** (e.g., `jhaabhishek@gmail.com` instead of `jha.abhishek@gmail.com`)
- ❌ **Confusing UX** - user entered one thing, sees another
- ❌ Cannot preserve original email format

**Impact:**
- Users will be confused when they see their email changed
- Not ideal UX

### Option 2: Use `.normalizeEmail()` but Preserve Original

**Approach:**
```javascript
body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Please provide a valid email address')

// In handler:
const originalEmail = req.body.email  // Before normalization
// ... normalize separately for duplicate checking
const normalizedEmail = normalizeEmailForLookup(originalEmail)
```

**Problem:** `.normalizeEmail()` mutates `req.body.email` **before** our handler runs, so we can't get the original.

**Workaround:**
```javascript
// Save original before validation
const originalEmail = req.body.email

body('email')
  .isEmail()
  .normalizeEmail()
  .custom((value, { req }) => {
    req.originalEmail = originalEmail  // Save original
    return true
  })
```

**Pros:**
- ✅ Uses standard library
- ✅ Can preserve original for display

**Cons:**
- ⚠️ **Complex workaround** - need to save original before validation
- ⚠️ Requires custom validation logic
- ⚠️ Still need custom function for duplicate checking (since we store normalized + original)

**Impact:**
- More complex code
- Still need custom normalization logic

### Option 3: Keep Our Custom Function (Current)

**Approach:**
- Custom `normalizeEmailForLookup()` function
- Store both `email` (exact) and `normalizedEmail` (for duplicate checking)

**Pros:**
- ✅ **Preserves exact user input** for display
- ✅ **Clear separation** - normalization only for duplicate checking
- ✅ **No request body mutation** - cleaner code
- ✅ **Full control** over normalization logic

**Cons:**
- ❌ **Custom code** - we maintain it
- ❌ **Doesn't handle `@googlemail.com`** (could add)
- ⚠️ Not a "standard" library

**Impact:**
- Best UX (users see exact email)
- Cleaner code (no workarounds)
- Need to maintain custom function

## Recommendation: Hybrid Approach

**Best of both worlds:**
1. **Use express-validator's `.normalizeEmail()` for validation** (but don't rely on it mutating the body)
2. **Extract the normalization logic** from express-validator's underlying `validator` library
3. **Or use `validator` library directly** for normalization (without mutating request body)

**Implementation:**
```javascript
const validator = require('validator')

// Normalize for duplicate checking (doesn't mutate original)
const normalizedEmail = validator.normalizeEmail(email, {
  gmail_lowercase: true,
  gmail_remove_dots: true,
  gmail_remove_subaddress: true,
  outlookdotcom_lowercase: true,
  yahoo_lowercase: true,
  icloud_lowercase: true
})
```

**Benefits:**
- ✅ Uses standard `validator` library (same as express-validator uses)
- ✅ Doesn't mutate request body
- ✅ Handles multiple providers (Gmail, Outlook, Yahoo, iCloud)
- ✅ Well-tested and maintained
- ✅ Preserves original email for display

## Comparison: Custom vs validator Library

| Feature | Our Custom | validator.normalizeEmail() |
|---------|------------|---------------------------|
| Gmail dots | ✅ | ✅ |
| Gmail +aliases | ✅ | ✅ |
| @googlemail.com | ❌ | ✅ |
| Outlook normalization | ❌ | ✅ |
| Yahoo normalization | ❌ | ✅ |
| iCloud normalization | ❌ | ✅ |
| Standard library | ❌ | ✅ |
| Maintenance | Us | Library maintainers |

## Final Recommendation

**Use `validator.normalizeEmail()` directly** (not via express-validator's middleware):

1. **Keep request body unchanged** - no `.normalizeEmail()` in validation chain
2. **Use `validator.normalizeEmail()` in our code** - for duplicate checking only
3. **Store both** - `email` (exact) and `normalizedEmail` (from validator library)

**Code Pattern:**
```javascript
const validator = require('validator')

// In createUser:
const normalizedEmail = validator.normalizeEmail(email.toLowerCase().trim(), {
  gmail_lowercase: true,
  gmail_remove_dots: true,
  gmail_remove_subaddress: true
})
```

**Benefits:**
- ✅ Standard library (`validator` - same one express-validator uses)
- ✅ Preserves original email for display
- ✅ Handles multiple email providers
- ✅ Well-tested and maintained
- ✅ No request body mutation

## Migration Impact

**If we switch to `validator.normalizeEmail()`:**
- ✅ No breaking changes - same behavior for Gmail
- ✅ Better - handles more providers
- ✅ Need to add `validator` package (or use from express-validator's dependencies)
- ✅ Minimal code changes - just replace our custom function

**Risk:** Low - `validator.normalizeEmail()` is the same function express-validator uses internally

