# BAA Testing Checklist

## Pre-Testing Setup

### 1. Environment Variables

**Verify in Railway Dashboard for each environment:**

**Dev Environment:**
```bash
RAILWAY_ENVIRONMENT_NAME=dev
```

**Staging Environment:**
```bash
RAILWAY_ENVIRONMENT_NAME=staging
```

**Production Environment:**
```bash
RAILWAY_ENVIRONMENT_NAME=production
```

**How to Check:**
1. Go to Railway Dashboard
2. Select environment (dev/staging/production)
3. Go to Variables tab
4. Verify `RAILWAY_ENVIRONMENT_NAME` is set correctly

---

## Test Scenarios

### Test 1: New Subscription Creation (Dev Environment)

**Steps:**
1. Create a new user account in dev environment
2. Upgrade to Pro plan
3. Sign BAA in the modal
4. Complete payment/checkout

**Expected Results:**
- ✅ BAA PDF generated
- ✅ Email sent (only 1 email)
- ✅ Check Stripe Dashboard → Webhook events
  - Should see `customer.subscription.created` event
  - Should see webhook delivered to dev endpoint (200 OK)
  - Should see webhook delivered to staging endpoint (200 OK) but staging should skip processing
  - Should see webhook delivered to production endpoint (200 OK) but production should skip processing

**Logs to Check:**
- Dev logs: Should see `✅ Processing subscription created` and BAA generation
- Staging logs: Should see `ℹ️ Skipping webhook - subscription environment (dev) doesn't match current environment (staging)`
- Production logs: Should see `ℹ️ Skipping webhook - subscription environment (dev) doesn't match current environment (production)`

---

### Test 2: Plan Upgrade (Basic → Pro)

**Steps:**
1. User with Basic plan upgrades to Pro
2. Sign BAA in the modal
3. Complete payment

**Expected Results:**
- ✅ BAA PDF generated
- ✅ Email sent (only 1 email)
- ✅ Check logs for `customer.subscription.updated` event

**Logs to Check:**
- Should see `🔄 Processing subscription updated`
- Should see BAA generation logs
- Only the environment that created the subscription should process it

---

### Test 3: Pro → Basic → Pro (BAA Persistence)

**Steps:**
1. User with Pro plan (has completed BAA)
2. Downgrade to Basic
3. Upgrade back to Pro

**Expected Results:**
- ✅ **No BAA prompt** (user already has completed BAA)
- ✅ **No BAA regeneration** (BAA persists)
- ✅ Logs should show: `ℹ️ User already has a completed BAA agreement - no need to regenerate`

**Logs to Check:**
- Should see `🔍 Checking for BAA agreement status...`
- Should see `ℹ️ User already has a completed BAA agreement - no need to regenerate`
- Should NOT see BAA PDF generation

---

### Test 4: Environment Filtering Verification

**Steps:**
1. Create subscription in dev environment
2. Check webhook delivery in Stripe Dashboard
3. Check logs in all three environments

**Expected Results:**
- ✅ Dev processes the webhook
- ✅ Staging receives webhook but skips processing (logs show skip message)
- ✅ Production receives webhook but skips processing (logs show skip message)

**Logs to Check:**
- **Dev**: `✅ Processing subscription created` + BAA generation
- **Staging**: `ℹ️ Skipping webhook - subscription environment (dev) doesn't match current environment (staging)`
- **Production**: `ℹ️ Skipping webhook - subscription environment (dev) doesn't match current environment (production)`

---

### Test 5: Duplicate Email Prevention

**Steps:**
1. Create subscription in dev
2. Check email inbox

**Expected Results:**
- ✅ Only **1 email** received (not 2 or 3)
- ✅ Email contains signed BAA PDF link

**If you receive 2 emails:**
- Check logs for transaction conflicts
- Check if both dev and staging processed it (environment filtering failed)
- Check if same environment processed it twice (transaction issue)

---

## Verification Commands

### Check Environment Variable in Logs

After creating a subscription, check logs for:
```
🔍 Checking for pending BAA signature on subscription creation...
```

If environment filtering is working, you should see in other environments:
```
ℹ️ Skipping webhook - subscription environment (dev) doesn't match current environment (staging)
```

### Check Subscription Metadata in Stripe

1. Go to Stripe Dashboard → Customers
2. Find the customer
3. Click on their subscription
4. Check "Metadata" section
5. Should see: `environment: dev` (or staging/production)

### Check BAA Status in Firestore

1. Go to Firestore Console
2. Navigate to `baa-agreements` collection
3. Find the user's BAA document
4. Verify:
   - `status: 'completed'`
   - `emailSent: true`
   - `emailSentAt: [timestamp]`
   - `pdfFilename: [filename]`

---

## Common Issues & Troubleshooting

### Issue 1: Still Getting Duplicate Emails

**Possible Causes:**
1. Environment variable not set correctly
2. Old subscription (created before environment metadata was added)
3. Transaction race condition (should be fixed, but check logs)

**Debug Steps:**
1. Check `RAILWAY_ENVIRONMENT_NAME` in Railway Dashboard
2. Check subscription metadata in Stripe (should have `environment` field)
3. Check logs for environment filtering messages
4. Check logs for transaction conflicts

### Issue 2: BAA Not Generated on Pro → Basic → Pro

**Expected Behavior:**
- User should NOT be prompted for BAA
- BAA should NOT be regenerated
- Logs should show: `ℹ️ User already has a completed BAA agreement - no need to regenerate`

**If BAA is regenerated:**
- Check if completed BAA exists in Firestore
- Check logs to see why it wasn't found

### Issue 3: Environment Filtering Not Working

**Possible Causes:**
1. `RAILWAY_ENVIRONMENT_NAME` not set
2. Subscription created before environment metadata was added
3. Environment variable value doesn't match metadata value

**Debug Steps:**
1. Check environment variable in Railway Dashboard
2. Check subscription metadata in Stripe Dashboard
3. Check logs for environment comparison messages

---

## Success Criteria

✅ **All tests pass:**
- New subscriptions generate BAA correctly
- Only 1 email sent per subscription
- Environment filtering works (other environments skip)
- BAA persists across plan changes (Pro → Basic → Pro)
- No duplicate processing

---

## Post-Testing Actions

After successful testing:
1. Document any issues found
2. Verify environment variables are set in all environments
3. Monitor logs for first few real subscriptions
4. Consider adding monitoring/alerting for duplicate emails

