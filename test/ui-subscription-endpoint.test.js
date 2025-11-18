/**
 * UI Subscription Endpoint Test
 * 
 * Verifies /api/billing/subscription returns correct data that matches Stripe
 */

const axios = require('axios');
const {
  createTestUserWithCustomer,
  generateTestToken,
  createTrialSubscription,
  cleanupTestUser,
  cleanupStripeCustomer
} = require('./test-utils');

const Stripe = require('stripe');

let testSecrets = {};
try {
  testSecrets = require('./test-secrets');
} catch (e) {}

const stripeSecret = testSecrets.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const API_URL = testSecrets.API_URL || process.env.API_URL || 'https://my-poppler-api-dev.up.railway.app';

const testDescribe = (!stripe || !stripeSecret || !stripeSecret.includes('sk_test_'))
  ? describe.skip
  : describe;

testDescribe('UI Subscription Endpoint Validation', () => {
  let testUsers = [];

  async function createTestClock() {
    const testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });
    return testClock.id;
  }

  afterAll(async () => {
    for (const user of testUsers) {
      if (user.customerId) {
        await cleanupStripeCustomer(user.customerId);
      }
      if (user.userId) {
        await cleanupTestUser(user.userId);
      }
    }
  });

  test('After Basic → Pro upgrade, /subscription endpoint returns Pro (not Basic)', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('UI VALIDATION: /subscription endpoint after upgrade');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const testClockId = await createTestClock();
    const { userId, email, customerId } = await createTestUserWithCustomer({
      testClockId,
      plan: 'basic',
      status: 'trialing'
    });
    testUsers.push({ userId, customerId });

    // Create Basic Monthly trial
    const subscription = await createTrialSubscription(
      customerId,
      'basic',
      'monthly',
      { userId, trialDays: 30 }
    );

    console.log('✅ Step 1: Created Basic Monthly trial');
    console.log(`   Subscription: ${subscription.id}`);

    const token = generateTestToken(userId, email);

    // Upgrade to Pro
    console.log('\n✅ Step 2: Upgrading to Pro...');
    await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlanId: 'pro', interval: 'monthly' },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    // Get Stripe subscription state
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);
    const stripeProduct = await stripe.products.retrieve(stripeSub.items.data[0].price.product);

    console.log('\n✅ Step 3: Verifying Stripe state...');
    console.log(`   Stripe Product: ${stripeProduct.name}`);
    console.log(`   Stripe Plan: ${stripeSub.metadata.planId}`);
    console.log(`   Stripe Interval: ${stripeSub.metadata.interval}`);

    // Get UI subscription data from /subscription endpoint
    console.log('\n✅ Step 4: Fetching /subscription endpoint...');
    const response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const uiData = response.data;

    console.log('\n📊 UI Data Received:');
    console.log(`   Plan: ${uiData.plan}`);
    console.log(`   Interval: ${uiData.interval}`);
    console.log(`   Status: ${uiData.status}`);
    console.log(`   Is Trial: ${uiData.isTrial}`);
    console.log(`   HIPAA Enabled: ${uiData.hipaaEnabled}`);
    console.log(`   Scheduled Change: ${uiData.scheduledChange}`);

    console.log('\n🔍 Comparison:');
    console.log('┌─────────────────────┬─────────────────────┬─────────────────────┐');
    console.log('│ Field               │ UI Data             │ Stripe              │');
    console.log('├─────────────────────┼─────────────────────┼─────────────────────┤');
    console.log(`│ Plan                │ ${uiData.plan.padEnd(19)} │ ${stripeSub.metadata.planId.padEnd(19)} │`);
    console.log(`│ Interval            │ ${uiData.interval.padEnd(19)} │ ${stripeSub.metadata.interval.padEnd(19)} │`);
    console.log(`│ Status              │ ${uiData.status.padEnd(19)} │ ${stripeSub.status.padEnd(19)} │`);
    console.log(`│ Is Trial            │ ${String(uiData.isTrial).padEnd(19)} │ ${String(stripeSub.status === 'trialing').padEnd(19)} │`);
    console.log('└─────────────────────┴─────────────────────┴─────────────────────┘');

    // CRITICAL ASSERTIONS - Prevent Option 2 bug
    console.log('\n✅ Step 5: Validating UI matches Stripe...');
    
    expect(uiData.plan).toBe('pro'); // ✅ UI shows Pro
    expect(uiData.plan).toBe(stripeSub.metadata.planId); // ✅ UI matches Stripe metadata
    expect(uiData.interval).toBe('monthly');
    expect(uiData.interval).toBe(stripeSub.metadata.interval);
    expect(uiData.status).toBe('trialing');
    expect(uiData.isTrial).toBe(true);
    expect(uiData.hipaaEnabled).toBe(true); // Pro has HIPAA
    expect(uiData.scheduledChange).toBeNull(); // No scheduled change with direct updates

    // Verify Stripe items also show Pro (not Basic)
    expect(stripeProduct.name).toContain('Pro');
    expect(stripeSub.items.data[0].price.id).toBe('price_1S8PQaRsohPcZDim8f6xylsh'); // Pro Monthly

    console.log('\n✅ ALL VALIDATIONS PASSED ✅');
    console.log('   - UI shows Pro (not Basic) ✅');
    console.log('   - UI data matches Stripe metadata ✅');
    console.log('   - Stripe items show Pro (not Basic) ✅');
    console.log('   - No false scheduled change ✅');
    console.log('   - HIPAA flag correct ✅');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }, 60000);

  test('After Monthly → Annual change, /subscription endpoint returns Annual', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('UI VALIDATION: /subscription endpoint after interval change');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const testClockId = await createTestClock();
    const { userId, email, customerId } = await createTestUserWithCustomer({
      testClockId,
      plan: 'pro',
      status: 'trialing'
    });
    testUsers.push({ userId, customerId });

    // Create Pro Monthly trial
    const subscription = await createTrialSubscription(
      customerId,
      'pro',
      'monthly',
      { userId, trialDays: 30 }
    );

    console.log('✅ Step 1: Created Pro Monthly trial');

    const token = generateTestToken(userId, email);

    // Change to Annual
    console.log('\n✅ Step 2: Changing to Annual...');
    await axios.post(
      `${API_URL}/api/billing/change-interval`,
      { newInterval: 'annual' },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    // Get Stripe subscription state
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);
    const stripePrice = stripeSub.items.data[0].price;

    console.log('\n✅ Step 3: Verifying Stripe state...');
    console.log(`   Stripe Interval: ${stripePrice.recurring.interval}`);
    console.log(`   Stripe Metadata Interval: ${stripeSub.metadata.interval}`);

    // Get UI subscription data
    console.log('\n✅ Step 4: Fetching /subscription endpoint...');
    const response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const uiData = response.data;

    console.log('\n📊 UI Data:');
    console.log(`   Interval: ${uiData.interval}`);

    // CRITICAL ASSERTIONS
    console.log('\n✅ Step 5: Validating...');
    expect(uiData.interval).toBe('annual'); // ✅ UI shows Annual
    expect(uiData.interval).toBe(stripeSub.metadata.interval); // ✅ UI matches Stripe
    expect(stripePrice.recurring.interval).toBe('year'); // ✅ Stripe items show Annual
    expect(uiData.scheduledChange).toBeNull(); // No false scheduled change

    console.log('\n✅ ALL VALIDATIONS PASSED ✅');
    console.log('   - UI shows Annual ✅');
    console.log('   - Stripe items show Annual ✅');
    console.log('   - No false scheduled change ✅\n');
  }, 60000);
});

