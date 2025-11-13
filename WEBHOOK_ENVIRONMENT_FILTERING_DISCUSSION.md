# Webhook Environment Filtering - Discussion

## How Stripe Webhooks Actually Work

### ⚠️ Key Understanding: Stripe Webhooks are **Broadcasts**, Not Request-Response

**How it works:**
1. An event happens in Stripe (e.g., subscription created)
2. Stripe sends the webhook to **ALL configured webhook endpoints** simultaneously
3. It's a **one-way broadcast** - Stripe doesn't know which environment triggered the change
4. Each endpoint processes the webhook independently

**From your Stripe Dashboard screenshot:**
- Event: `invoice.payment_succeeded`
- Stripe sent to **ALL three endpoints**:
  - ✅ `https://my-poppler-api-dev.up.railway.app/api/billing/webhook` (200 OK)
  - ❌ `https://my-poppler-api-production.up.railway.app/api/billing/webhook` (404 ERR)
  - ✅ `https://my-poppler-api-staging.up.railway.app/api/billing/webhook` (200 OK)

**This confirms:** Stripe sends to ALL endpoints, regardless of which environment created the subscription.

---

## The Problem

When a subscription is created in **dev**:
1. Dev environment creates subscription with metadata
2. Stripe sends webhook to **dev, staging, AND production**
3. All three environments receive the same webhook
4. All three try to process it → **duplicate BAA emails**

---

## Solution Options

### Option 1: Environment Metadata Filtering (What I Implemented)

**How it works:**
1. When creating checkout, add `environment: 'dev'` to subscription metadata
2. When webhook arrives, check `subscription.metadata.environment`
3. If it doesn't match current environment, skip processing

**Pros:**
- ✅ Simple to implement
- ✅ No infrastructure changes
- ✅ Works for new subscriptions

**Cons:**
- ❌ Only works for **new subscriptions** (old ones don't have metadata)
- ❌ Requires correct environment variable (`RAILWAY_ENVIRONMENT_NAME`)
- ❌ Old subscriptions will still be processed by all environments

**Code:**
```javascript
// When creating checkout (routes/billing.js)
subscription_data: {
  metadata: {
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || 'dev'
  }
}

// When processing webhook (server.js)
const subscriptionEnv = subscription.metadata?.environment;
const currentEnv = process.env.RAILWAY_ENVIRONMENT_NAME || 'dev';
if (subscriptionEnv && subscriptionEnv !== currentEnv) {
  return; // Skip - wrong environment
}
```

**Status:** ✅ Implemented, but needs `RAILWAY_ENVIRONMENT_NAME` fix

---

### Option 2: Separate Stripe Accounts (Recommended for Production)

**How it works:**
- Dev/staging use **Stripe Test Mode** account
- Production uses **Stripe Live Mode** account
- Complete isolation - no cross-environment events

**Pros:**
- ✅ Complete isolation
- ✅ No duplicate processing
- ✅ Standard practice for multi-environment setups
- ✅ Better security (test vs live keys)

**Cons:**
- ❌ Requires separate Stripe accounts
- ❌ Need to manage two sets of keys
- ❌ More complex setup

**Implementation:**
- Already partially in place (test vs live keys)
- Just need to ensure dev/staging use test account
- Production uses live account

---

### Option 3: Webhook Endpoint Filtering (Not Possible)

**Why it doesn't work:**
- Stripe sends to ALL configured endpoints
- Can't tell Stripe "only send to dev for dev subscriptions"
- Stripe doesn't know which environment created the subscription

**Status:** ❌ Not feasible

---

### Option 4: Idempotency + Environment Check (Hybrid)

**How it works:**
1. Use environment metadata filtering (Option 1)
2. Add idempotency checks (already in place)
3. Accept that old subscriptions might be processed by multiple environments
4. Rely on idempotency to prevent duplicate actions

**Pros:**
- ✅ Works for new subscriptions
- ✅ Idempotency prevents duplicate actions
- ✅ Acceptable for old subscriptions (they'll expire)

**Cons:**
- ⚠️ Old subscriptions still processed by all environments
- ⚠️ Requires correct environment variable

**Status:** ✅ Best practical solution (what we have now)

---

## Current Implementation Analysis

### What I Implemented:
1. ✅ Environment metadata added to subscriptions
2. ✅ Environment check in webhook handlers
3. ❌ **Wrong environment variable name** - using `RAILWAY_ENVIRONMENT` instead of `RAILWAY_ENVIRONMENT_NAME`

### What Needs Fixing:
1. **Environment Variable:** Change from `RAILWAY_ENVIRONMENT` to `RAILWAY_ENVIRONMENT_NAME`
2. **BAA Logic:** Already fixed - checks for completed BAA first

---

## Recommendation

### Short Term (Now):
1. Fix environment variable name to `RAILWAY_ENVIRONMENT_NAME`
2. Keep the metadata filtering approach
3. Accept that old subscriptions might be processed by multiple environments
4. Rely on idempotency checks to prevent duplicate actions

### Long Term (Future):
1. Consider separate Stripe accounts for complete isolation
2. Or accept the current approach (it's working with idempotency)

---

## Questions to Answer

1. **Do you want to use separate Stripe accounts?**
   - More setup, but complete isolation
   - Standard practice for production apps

2. **Is the current approach acceptable?**
   - New subscriptions will be filtered correctly
   - Old subscriptions might be processed by multiple environments
   - Idempotency prevents duplicate actions

3. **What should we do about old subscriptions?**
   - Option A: Accept they'll be processed by all environments (idempotency protects)
   - Option B: Add migration script to add environment metadata to existing subscriptions
   - Option C: Wait for them to expire naturally

---

## Next Steps

1. Fix environment variable name (`RAILWAY_ENVIRONMENT_NAME`)
2. Test with new subscription to verify filtering works
3. Decide on long-term approach (separate accounts vs current approach)

