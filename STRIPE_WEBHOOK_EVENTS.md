# Required Stripe Webhook Events

## Webhook Endpoint
**URL**: `https://your-backend-url.com/api/billing/webhook`

## Required Events for BAA Functionality

### 🔴 CRITICAL (Required for BAA)

1. **`customer.subscription.created`** ⭐ PRIMARY TRIGGER
   - **Purpose**: Generates BAA PDF when subscription is created (trial or active)
   - **When it fires**: Immediately after checkout completes and subscription is created
   - **Handler**: `handleSubscriptionCreated()`
   - **BAA Action**: Generates PDF and sends email
   - **Status**: ✅ REQUIRED - This is the primary trigger for BAA generation

2. **`customer.subscription.updated`** ⭐ PRIMARY TRIGGER
   - **Purpose**: Generates BAA PDF when subscription plan changes to Pro/Enterprise
   - **When it fires**: When subscription plan, status, or metadata changes
   - **Handler**: `handleSubscriptionUpdated()`
   - **BAA Action**: Generates PDF and sends email (for Pro/Enterprise upgrades)
   - **Status**: ✅ REQUIRED - Handles plan upgrades

3. **`invoice.payment_succeeded`** ⚠️ NOT USED FOR BAA
   - **Purpose**: Records payment date (BAA generation removed to avoid race conditions)
   - **When it fires**: When payment succeeds (including $0 trial invoices)
   - **Handler**: `handlePaymentSucceeded()`
   - **BAA Action**: None - BAA generation only happens via subscription events
   - **Status**: ✅ REQUIRED - For payment tracking (not BAA)

## Required Events for Subscription Management

4. **`customer.subscription.deleted`**
   - **Purpose**: Handles subscription cancellation
   - **When it fires**: When subscription is permanently deleted
   - **Handler**: `handleSubscriptionDeleted()`
   - **Action**: Reverts user to free plan
   - **Status**: ✅ REQUIRED

5. **`invoice.payment_failed`**
   - **Purpose**: Handles failed payments
   - **When it fires**: When payment attempt fails
   - **Handler**: `handlePaymentFailed()`
   - **Action**: Logs failure, tracks grace period
   - **Status**: ✅ REQUIRED

6. **`customer.subscription.trial_will_end`**
   - **Purpose**: Notifies before trial ends
   - **When it fires**: 3 days before trial period ends
   - **Handler**: `handleTrialWillEnd()`
   - **Action**: Prepares for trial-to-paid conversion
   - **Status**: ✅ REQUIRED (for trial management)

## Recommended Events (Not Currently Handled)

7. **`invoice.upcoming`** 💡 RECOMMENDED
   - **Purpose**: Fires 7 days before invoice is due (for recurring subscriptions)
   - **When it fires**: Before each billing cycle
   - **Use Case**: Send payment reminders, notify users of upcoming charges
   - **Status**: 💡 RECOMMENDED - Good UX practice
   - **Note**: I see this event in your Workbench, but it's not handled in code yet

8. **`invoice.payment_action_required`** 💡 RECOMMENDED
   - **Purpose**: Fires when payment requires 3D Secure or other authentication
   - **When it fires**: When customer needs to authenticate payment (3DS, SCA)
   - **Use Case**: Notify user to complete payment authentication
   - **Status**: 💡 RECOMMENDED - Important for payment success
   - **Note**: Currently not handled - users might not know they need to authenticate

9. **`invoice.paid`** ⚪ OPTIONAL
   - **Purpose**: Fires when invoice is marked as paid
   - **When it fires**: After `invoice.payment_succeeded` (confirmation)
   - **Use Case**: Additional confirmation of payment
   - **Status**: ⚪ OPTIONAL - Redundant with `payment_succeeded`

10. **`invoice.finalized`** ⚪ OPTIONAL
    - **Purpose**: Fires when draft invoice is finalized
    - **When it fires**: When invoice moves from draft to final
    - **Use Case**: Track invoice lifecycle
    - **Status**: ⚪ OPTIONAL - Not critical for current functionality

11. **`checkout.session.completed`** ⚪ OPTIONAL
    - **Purpose**: Fires when checkout session completes
    - **Status**: ⚪ OPTIONAL - Currently unhandled (not needed for BAA)
    - **Note**: Subscription is created after this, so `subscription.created` is more reliable

## Events for Payment Processing (Separate Endpoint)

**Endpoint**: `/api/stripe/webhook` (for form payment processing)

8. **`payment_intent.succeeded`**
   - **Purpose**: Handles successful form payments
   - **Status**: ✅ REQUIRED (for form payment processing)

9. **`payment_intent.payment_failed`**
   - **Purpose**: Handles failed form payments
   - **Status**: ✅ REQUIRED (for form payment processing)

10. **`account.updated`**
    - **Purpose**: Handles Stripe Connect account updates
    - **Status**: ✅ REQUIRED (for Stripe Connect integration)

## Complete Event List for Stripe Dashboard

### For `/api/billing/webhook` endpoint:

**🔴 CRITICAL - Currently Missing:**
- `customer.subscription.created` ⚠️ **MUST ADD THIS** - Primary BAA trigger

**✅ Currently Subscribed:**
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `checkout.session.completed` (optional, not used for BAA)

**Complete Required List:**
```
customer.subscription.created  ⚠️ ADD THIS (CRITICAL)
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
customer.subscription.trial_will_end
```

**Recommended Additional Events:**
```
invoice.upcoming              💡 RECOMMENDED (payment reminders)
invoice.payment_action_required  💡 RECOMMENDED (3DS authentication)
```

**Optional Events (Nice to Have):**
```
invoice.paid                  ⚪ OPTIONAL (confirmation)
invoice.finalized             ⚪ OPTIONAL (tracking)
checkout.session.completed    ⚪ OPTIONAL (already subscribed, not used)
```

### For `/api/stripe/webhook` endpoint (if using form payments):

```
payment_intent.succeeded
payment_intent.payment_failed
account.updated
```

## How to Configure in Stripe Dashboard

1. Go to **Stripe Dashboard** → **Developers** → **Webhooks**
2. Click **"Add endpoint"** or edit existing endpoint
3. **Endpoint URL**: `https://your-backend-url.com/api/billing/webhook`
4. **Events to send**: Select the events listed above
5. **Or use "Select events"** and choose (9 total):
   - `customer.subscription.created` ⚠️ **CRITICAL**
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `invoice.upcoming` 💡 **RECOMMENDED**
   - `invoice.payment_action_required` 💡 **RECOMMENDED**
   - `checkout.session.completed` (optional)
6. **Save** the webhook
7. Copy the **Signing secret** and set as `STRIPE_WEBHOOK_SECRET` environment variable

## Event Priority for BAA Generation

1. **Primary**: `customer.subscription.created` - Generates BAA when subscription is created (trial or active)
2. **Secondary**: `customer.subscription.updated` - Generates BAA when upgrading to Pro/Enterprise
3. **Note**: `invoice.payment_succeeded` is NOT used for BAA generation to avoid race conditions and ensure we rely on the correct, mutually exclusive events

## Testing Checklist

After configuring webhooks, verify:

- [ ] `customer.subscription.created` appears in logs when subscription is created
- [ ] `customer.subscription.updated` appears when plan changes
- [ ] `invoice.payment_succeeded` appears when payment succeeds
- [ ] BAA PDF is generated on subscription creation
- [ ] Email is sent with PDF link
- [ ] Firestore record status changes from `pending_payment` → `completed`

## Troubleshooting

**If `customer.subscription.created` doesn't fire:**
1. Check Stripe Dashboard → Webhooks → Events
2. Verify event is enabled for your webhook endpoint
3. Check webhook delivery logs in Stripe Dashboard
4. Verify webhook URL is correct and accessible
5. Check webhook secret is configured correctly

**If webhook fires but BAA isn't generated:**
1. Check backend logs for `✅ Processing subscription created`
2. Check for errors in `handleSubscriptionCreated`
3. Verify BAA record exists in Firestore with `status: 'pending_payment'`
4. Check Firestore index is created and enabled

