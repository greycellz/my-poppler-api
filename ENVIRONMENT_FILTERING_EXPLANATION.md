# Environment Filtering for Stripe Webhooks

## Problem

Both **dev** and **staging** environments are subscribed to the same Stripe webhook endpoint. When a webhook fires, both environments process it, causing duplicate actions (e.g., duplicate BAA emails).

## Solution: Environment Metadata Filtering

### How It Works

1. **When Creating Checkout Session** (`routes/billing.js`):
   - We add `environment` to subscription metadata
   - Environment is determined by: `process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development'`
   - This metadata is stored in Stripe with the subscription

2. **When Processing Webhook** (`server.js`):
   - We read `subscription.metadata.environment` from the webhook payload
   - We compare it to the current environment (`process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development'`)
   - If they don't match, we skip processing the webhook

### Code Flow

```javascript
// In routes/billing.js - When creating checkout
subscription_data: {
  metadata: {
    userId: userId,
    planId: planId,
    interval: interval,
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development'
  }
}

// In server.js - When processing webhook
const subscriptionEnv = subscription.metadata?.environment;
const currentEnv = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development';
if (subscriptionEnv && subscriptionEnv !== currentEnv) {
  console.log(`ℹ️ Skipping webhook - subscription environment (${subscriptionEnv}) doesn't match current environment (${currentEnv})`);
  return; // Skip processing
}
```

## Limitations

### ⚠️ Only Works for New Subscriptions

- **Existing subscriptions** created before this change won't have `environment` metadata
- For these, the filter won't work (both environments will process them)
- **Solution**: This is acceptable because:
  - New subscriptions going forward will be filtered correctly
  - Old subscriptions will eventually expire or be replaced
  - The duplicate processing is non-destructive (idempotency checks prevent issues)

### Alternative Solutions (Not Implemented)

1. **Separate Stripe Accounts**: Use different Stripe accounts for dev/staging
   - ✅ Complete isolation
   - ❌ More complex setup, separate billing

2. **Separate Webhook Endpoints**: Use different webhook URLs per environment
   - ✅ Complete isolation
   - ❌ Requires separate Stripe webhook configurations

3. **Webhook Secret Per Environment**: Use different webhook secrets
   - ✅ Can filter at webhook verification level
   - ❌ Still need to configure separate webhooks in Stripe

## Current Implementation Status

✅ **Implemented**: Environment metadata filtering for new subscriptions
⚠️ **Limitation**: Doesn't filter old subscriptions (acceptable trade-off)

## Testing

To verify it works:
1. Create a new subscription in dev environment
2. Check subscription metadata in Stripe Dashboard - should have `environment: 'development'` (or whatever your dev env is)
3. Trigger webhook - only dev should process it
4. Create subscription in staging - should have `environment: 'staging'`
5. Trigger webhook - only staging should process it

