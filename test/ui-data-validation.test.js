/**
 * Test Suite: UI Data Validation
 * 
 * Purpose: Verify that the /subscription endpoint returns correct data
 * and that there are no mismatches between Stripe items and metadata
 * 
 * This prevents issues like:
 * - UI showing Pro but Stripe showing Basic (Option 2 bug)
 * - Scheduled changes incorrectly detected
 * - Wrong trial status
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || require('./test-secrets').STRIPE_SECRET_KEY);
const axios = require('axios');
const { 
  createTestUserWithCustomer, 
  createTrialSubscription, 
  generateTestToken, 
  cleanupTestUser
} = require('./test-utils');

const API_URL = process.env.API_URL || require('./test-secrets').API_URL;

describe('UI Data Validation Tests', () => {
  let testUser;
  let testCustomer;
  let testClock;
  let jwt;

  beforeEach(async () => {
    testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: `test-clock-${Date.now()}`
    });

    const setup = await createTestUserWithCustomer({ testClockId: testClock.id });
    testUser = { userId: setup.userId, email: setup.email };
    testCustomer = setup.customer;
    jwt = generateTestToken(setup.userId, setup.email);
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId, testCustomer.id, testClock.id);
  });

  /**
   * Critical Test: Verify no mismatch between Stripe items and UI display
   */
  test('UI shows same plan as Stripe items (no mismatch)', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST: UI-Stripe Data Consistency');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create Basic Monthly trial
    const subscription = await createTrialSubscription(
      testCustomer.id,
      'basic',
      'monthly',
      { userId: testUser.userId, trialDays: 30 }
    );

    console.log('✅ Created Basic Monthly trial');

    // Upgrade to Pro
    await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlan: 'pro' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log('✅ Upgraded to Pro Monthly');

    // Get UI data
    const response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    const uiData = response.data;

    // Get Stripe data
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);
    const stripeProduct = await stripe.products.retrieve(stripeSub.items.data[0].price.product);
    const stripePrice = stripeSub.items.data[0].price;

    console.log('\n📊 Comparison:');
    console.log('┌─────────────────────┬─────────────────────┬─────────────────────┐');
    console.log('│ Field               │ UI Data             │ Stripe Items        │');
    console.log('├─────────────────────┼─────────────────────┼─────────────────────┤');
    console.log(`│ Plan                │ ${uiData.plan.padEnd(19)} │ ${stripeProduct.name.includes('Pro') ? 'pro' : 'basic'} (${stripeProduct.name.substring(0, 12)}...) │`);
    console.log(`│ Interval            │ ${uiData.interval.padEnd(19)} │ ${stripePrice.recurring.interval === 'year' ? 'annual' : 'monthly'}               │`);
    console.log(`│ Status              │ ${uiData.status.padEnd(19)} │ ${stripeSub.status.padEnd(19)} │`);
    console.log(`│ Trial End           │ ${new Date(uiData.trialEnd * 1000).toISOString().padEnd(19)} │ ${new Date(stripeSub.trial_end * 1000).toISOString().padEnd(19)} │`);
    console.log('└─────────────────────┴─────────────────────┴─────────────────────┘');

    // CRITICAL ASSERTIONS
    const stripePlanId = stripeProduct.name.includes('Pro') ? 'pro' : 'basic';
    const stripeInterval = stripePrice.recurring.interval === 'year' ? 'annual' : 'monthly';

    expect(uiData.plan).toBe(stripePlanId);
    expect(uiData.interval).toBe(stripeInterval);
    expect(uiData.status).toBe(stripeSub.status);
    expect(uiData.trialEnd).toBe(stripeSub.trial_end);
    expect(uiData.isTrial).toBe(true);

    // Verify metadata also matches
    expect(stripeSub.metadata.planId).toBe(uiData.plan);
    expect(stripeSub.metadata.interval).toBe(uiData.interval);

    console.log('\n✅ PASSED: UI data matches Stripe items exactly ✅');
    console.log('   No mismatch detected (Option 2 bug prevented)\n');
  }, 60000);

  /**
   * Test trial status detection
   */
  test('Trial status correctly detected in UI', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST: Trial Status Detection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create trial subscription
    const subscription = await createTestSubscription(
      testCustomer.id,
      'price_1S8PQaRsohPcZDim8f6xylsh',
      { userId: testUser.userId, planId: 'pro', interval: 'monthly' },
      30
    );

    const trialEnd = subscription.trial_end;
    const now = Math.floor(Date.now() / 1000);

    console.log(`   Trial end: ${new Date(trialEnd * 1000).toISOString()}`);
    console.log(`   Now: ${new Date(now * 1000).toISOString()}`);
    console.log(`   Days remaining: ${Math.ceil((trialEnd - now) / 86400)}`);

    // Get UI data
    const response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    const uiData = response.data;

    console.log('\n📊 UI Trial Data:');
    console.log(`   isTrial: ${uiData.isTrial}`);
    console.log(`   status: ${uiData.status}`);
    console.log(`   trialEnd: ${new Date(uiData.trialEnd * 1000).toISOString()}`);
    console.log(`   trialEndingSoon: ${uiData.trialEndingSoon}`);

    // Assertions
    expect(uiData.isTrial).toBe(true);
    expect(uiData.status).toBe('trialing');
    expect(uiData.trialEnd).toBe(trialEnd);

    // Trial ending soon should be false (30 days remaining)
    expect(uiData.trialEndingSoon).toBe(false);

    console.log('\n✅ PASSED: Trial status correctly detected ✅\n');
  }, 60000);

  /**
   * Test scheduled change detection (should be null with direct updates)
   */
  test('No false scheduled changes detected with direct updates', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST: Scheduled Change Detection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create Basic Monthly trial
    const subscription = await createTrialSubscription(
      testCustomer.id,
      'basic',
      'monthly',
      { userId: testUser.userId, trialDays: 30 }
    );

    console.log('✅ Created Basic Monthly trial');

    // Upgrade to Pro (direct update)
    await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlan: 'pro' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log('✅ Upgraded to Pro (direct update during trial)');

    // Get UI data
    const response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    const uiData = response.data;

    console.log('\n📊 Scheduled Change Data:');
    console.log(`   scheduledChange: ${uiData.scheduledChange}`);
    console.log(`   plan: ${uiData.plan}`);
    console.log(`   interval: ${uiData.interval}`);

    // Get Stripe data
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);

    console.log('\n📊 Stripe Metadata:');
    console.log(`   scheduledPlanId: ${stripeSub.metadata.scheduledPlanId || 'null'}`);
    console.log(`   scheduledInterval: ${stripeSub.metadata.scheduledInterval || 'null'}`);

    // CRITICAL: No scheduled change should be detected
    // Items were updated directly, so current plan IS the plan shown
    expect(uiData.scheduledChange).toBeNull();
    expect(stripeSub.metadata.scheduledPlanId).toBeNull();
    expect(stripeSub.metadata.scheduledInterval).toBeNull();

    console.log('\n✅ PASSED: No false scheduled changes detected ✅');
    console.log('   (Option 2 bug prevented - no price mismatch interpretation)\n');
  }, 60000);

  /**
   * Test HIPAA flag consistency
   */
  test('HIPAA flag consistent between UI and Stripe', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST: HIPAA Flag Consistency');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create Basic trial (no HIPAA)
    let subscription = await createTrialSubscription(
      testCustomer.id,
      'basic',
      'monthly',
      { userId: testUser.userId, trialDays: 30 }
    );

    console.log('✅ Created Basic Monthly trial (no HIPAA)');

    // Check HIPAA flag
    let response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log(`   UI hipaaEnabled: ${response.data.hipaaEnabled}`);
    expect(response.data.hipaaEnabled).toBe(false);

    // Upgrade to Pro (has HIPAA)
    await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlan: 'pro' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log('\n✅ Upgraded to Pro Monthly (has HIPAA)');

    // Check HIPAA flag again
    response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log(`   UI hipaaEnabled: ${response.data.hipaaEnabled}`);
    expect(response.data.hipaaEnabled).toBe(true);

    console.log('\n✅ PASSED: HIPAA flag updates correctly ✅\n');
  }, 60000);

  /**
   * Test interval display in UI
   */
  test('Interval correctly displayed in UI after changes', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST: Interval Display Consistency');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create Pro Monthly trial
    const subscription = await createTestSubscription(
      testCustomer.id,
      'price_1S8PQaRsohPcZDim8f6xylsh',
      { userId: testUser.userId, planId: 'pro', interval: 'monthly' },
      30
    );

    console.log('✅ Created Pro Monthly trial');

    // Check initial interval
    let response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log(`   UI interval: ${response.data.interval}`);
    expect(response.data.interval).toBe('monthly');

    // Change to Annual
    await axios.post(
      `${API_URL}/api/billing/change-interval`,
      { newInterval: 'annual' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log('\n✅ Changed to Annual billing');

    // Check updated interval
    response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    console.log(`   UI interval: ${response.data.interval}`);
    expect(response.data.interval).toBe('annual');

    // Verify Stripe also shows Annual
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);
    const stripeInterval = stripeSub.items.data[0].price.recurring.interval;

    console.log(`   Stripe interval: ${stripeInterval}`);
    expect(stripeInterval).toBe('year'); // Stripe uses 'year', we map to 'annual'

    console.log('\n✅ PASSED: Interval display consistent ✅\n');
  }, 60000);
});

