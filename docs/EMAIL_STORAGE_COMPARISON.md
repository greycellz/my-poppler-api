# Email Storage Comparison: Old vs Current vs Proposed

## Scenario: User Signs Up with `jha.abhishek@gmail.com`

### ❌ OLD CODE (Before Fix - Had the Problem)

**Code:**
```javascript
body('email')
  .isEmail()
  .normalizeEmail()  // ← Middleware mutates req.body.email
```

**What Happens:**
1. User enters: `jha.abhishek@gmail.com`
2. `.normalizeEmail()` middleware runs → `req.body.email` = `jhaabhishek@gmail.com` (mutated)
3. Handler receives: `req.body.email` = `jhaabhishek@gmail.com`
4. Stored: `email: "jhaabhishek@gmail.com"` (normalized - dots removed)
5. Display shows: `jhaabhishek@gmail.com` ❌ **Problem: User sees different email than they entered**

**Result:** ❌ User confusion - email changed

---

### ✅ CURRENT CODE (After Fix - Works Correctly)

**Code:**
```javascript
body('email')
  .isEmail()
  // No .normalizeEmail() - preserves original

// In createUser:
const normalizedEmail = normalizeEmailForLookup(email)  // Custom function
userData = {
  email: email.toLowerCase().trim(),  // Exact email (preserved)
  normalizedEmail: normalizedEmail  // For duplicate checking
}
```

**What Happens:**
1. User enters: `jha.abhishek@gmail.com`
2. No middleware mutation → `req.body.email` = `jha.abhishek@gmail.com` (preserved)
3. Handler receives: `req.body.email` = `jha.abhishek@gmail.com`
4. Stored: 
   - `email: "jha.abhishek@gmail.com"` (exact - preserved)
   - `normalizedEmail: "jhaabhishek@gmail.com"` (for duplicate checking)
5. Display shows: `jha.abhishek@gmail.com` ✅ **Correct: User sees exact email**

**Result:** ✅ User sees exact email, duplicate checking works

---

### ✅ PROPOSED CODE (Using validator.normalizeEmail() - Standard Library)

**Code:**
```javascript
const validator = require('validator')

body('email')
  .isEmail()
  // No .normalizeEmail() - preserves original

// In createUser:
const normalizedEmail = validator.normalizeEmail(email.toLowerCase().trim(), {
  gmail_lowercase: true,
  gmail_remove_dots: true,
  gmail_remove_subaddress: true
})
userData = {
  email: email.toLowerCase().trim(),  // Exact email (preserved)
  normalizedEmail: normalizedEmail  // For duplicate checking (standard library)
}
```

**What Happens:**
1. User enters: `jha.abhishek@gmail.com`
2. No middleware mutation → `req.body.email` = `jha.abhishek@gmail.com` (preserved)
3. Handler receives: `req.body.email` = `jha.abhishek@gmail.com`
4. Stored: 
   - `email: "jha.abhishek@gmail.com"` (exact - preserved) ✅ **SAME AS CURRENT**
   - `normalizedEmail: "jhaabhishek@gmail.com"` (using validator library) ✅ **SAME BEHAVIOR**
5. Display shows: `jha.abhishek@gmail.com` ✅ **SAME AS CURRENT**

**Result:** ✅ User sees exact email, duplicate checking works, uses standard library

---

## Key Differences

| Aspect | Old Code | Current Code | Proposed Code |
|--------|----------|--------------|---------------|
| **Middleware** | `.normalizeEmail()` | None | None |
| **Request Body** | Mutated (normalized) | Preserved (original) | Preserved (original) |
| **Stored `email`** | Normalized | Exact | Exact |
| **Stored `normalizedEmail`** | N/A | Custom function | validator library |
| **Display** | Normalized ❌ | Exact ✅ | Exact ✅ |
| **Duplicate Check** | Works (via normalized storage) | Works (via normalizedEmail field) | Works (via normalizedEmail field) |
| **Standard Library** | ✅ Yes (express-validator) | ❌ No (custom) | ✅ Yes (validator) |

## Conclusion

**Cannot revert to old code** - it had the mutation problem.

**Proposed change is NOT a revert** - it's:
- Replace custom function with standard library function
- Keep same behavior (preserve original, normalize for duplicate checking)
- No change to stored email or display

**The only difference:** Uses `validator.normalizeEmail()` instead of our custom function (same behavior, standard library)

