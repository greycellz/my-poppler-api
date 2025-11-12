# BAA Email Sending - Code Locations

## Email Sending Function

**Location**: `my-poppler-api/email-service.js`
**Function**: `sendBAAConfirmationEmail(userEmail, userName, pdfFilename)`
**Line**: ~285

This is the ONLY function that sends BAA confirmation emails. It uses Mailgun API.

## Where Email is Called From

### 1. `handleSubscriptionCreated` (Primary Trigger)
**Location**: `my-poppler-api/server.js`
**Line**: ~228-254
**Trigger**: `customer.subscription.created` webhook event
**Flow**:
1. Generates BAA PDF
2. Updates BAA record to `completed` with `emailSent: false`
3. **Checks `emailSent` flag** (NEW - added fix)
4. If `emailSent === false`, sends email
5. Updates `emailSent: true` after successful send

### 2. `handleSubscriptionUpdated` (Plan Upgrades)
**Location**: `my-poppler-api/server.js`
**Line**: ~438-477
**Trigger**: `customer.subscription.updated` webhook event
**Flow**: Same as above

### 3. `handlePaymentSucceeded` (Fallback)
**Location**: `my-poppler-api/server.js`
**Line**: ~687-734
**Trigger**: `invoice.payment_succeeded` webhook event
**Flow**: Same as above

### 4. Fallback in Idempotency Check
**Location**: `my-poppler-api/server.js`
**Line**: ~612-628 (in both `handleSubscriptionCreated` and `handlePaymentSucceeded`)
**Trigger**: When PDF already exists but email wasn't sent
**Flow**: Checks `emailSent` flag and sends if needed

## Debug Logging Added

All email sending now includes:
- **Webhook ID**: Unique identifier for each webhook handler call
- **Email Call ID**: Unique identifier for each email service call
- **Email Check Logs**: Shows `emailSent` flag status before sending
- **Email Result Logs**: Shows success/failure and Mailgun message ID

## Potential Issues

1. **Race Condition**: If two webhooks fire simultaneously, both might see `emailSent: false` before either updates it to `true`
   - **Mitigation**: Added atomic check right before sending (re-reads document)
   
2. **Mailgun Duplicates**: Mailgun might be sending duplicates if called with same parameters
   - **Check**: Look for multiple `[EMAIL SERVICE]` log entries with different `emailCallId` values
   
3. **Multiple Webhook Events**: Both `subscription.created` and `payment.succeeded` might fire
   - **Mitigation**: All handlers now check `emailSent` flag before sending

## How to Debug

1. Check logs for `[EMAIL SERVICE]` entries - each should have unique `emailCallId`
2. Check logs for `Email check` entries - shows `emailSent` flag status
3. Check logs for `Email result` entries - shows if email was actually sent
4. If you see 2 emails but only 1 log entry, check Mailgun dashboard for duplicate sends

