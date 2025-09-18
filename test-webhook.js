const axios = require('axios');
const crypto = require('crypto');

// Test webhook endpoint
const WEBHOOK_URL = 'http://localhost:3000/api/billing/webhook';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';

// Sample subscription data
const sampleSubscription = {
  id: 'sub_test_123',
  customer: 'cus_test_123',
  status: 'active',
  current_period_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days from now
  metadata: {
    userId: 'test_user_123',
    planId: 'pro',
    interval: 'monthly'
  }
};

// Sample invoice data
const sampleInvoice = {
  id: 'in_test_123',
  subscription: 'sub_test_123',
  amount_paid: 2900, // $29.00
  currency: 'usd',
  status: 'paid'
};

// Create webhook signature
function createWebhookSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

// Test webhook event
async function testWebhookEvent(eventType, data) {
  try {
    const payload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      object: 'event',
      type: eventType,
      data: { object: data },
      created: Math.floor(Date.now() / 1000)
    });

    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    console.log(`🧪 Testing ${eventType}...`);
    console.log(`📤 Payload:`, JSON.parse(payload));

    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature
      }
    });

    console.log(`✅ Response:`, response.status, response.data);
    return true;
  } catch (error) {
    console.error(`❌ Error testing ${eventType}:`, error.response?.data || error.message);
    return false;
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Starting webhook tests...\n');

  const tests = [
    { event: 'customer.subscription.created', data: sampleSubscription },
    { event: 'customer.subscription.updated', data: { ...sampleSubscription, status: 'past_due' } },
    { event: 'invoice.payment_succeeded', data: sampleInvoice },
    { event: 'invoice.payment_failed', data: { ...sampleInvoice, status: 'open' } },
    { event: 'customer.subscription.deleted', data: sampleSubscription }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await testWebhookEvent(test.event, test.data);
    if (success) {
      passed++;
    } else {
      failed++;
    }
    console.log(''); // Empty line for readability
  }

  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All webhook tests passed!');
  } else {
    console.log('⚠️ Some tests failed. Check the logs above.');
  }
}

// Check if running directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testWebhookEvent, runTests };
