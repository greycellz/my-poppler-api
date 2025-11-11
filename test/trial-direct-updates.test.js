/**
 * Test Suite: Direct Updates with proration_behavior: 'none'
 * 
 * Purpose: Verify the rollback from Option 2 (metadata-only) to direct updates
 * 
 * Key Verifications:
 * 1. Zero charges during trial
 * 2. Stripe dashboard shows correct plan
 * 3. Invoice preview shows correct amount
 * 4. Trial period preserved
 * 5. $0 invoices created (expected behavior)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || require('./test-secrets').STRIPE_SECRET_KEY);
const axios = require('axios');
const { 
  createTestUserWithCustomer, 
  createTestSubscription, 
  generateJWT, 
  cleanupTestUser,
  advanceTestClock
} = require('./test-utils');

const API_URL = process.env.API_URL || require('./test-secrets').API_URL;

describe('Trial Direct Updates (Rollback Verification)', () => {
  let testUser;
  let testCustomer;
  let testClock;
  let jwt;

  beforeEach(async () => {
    // Create a new test clock for each test
    testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: `test-clock-${Date.now()}`
    });

    // Create test user with customer
    const setup = await createTestUserWithCustomer(testClock.id);
    testUser = setup.user;
    testCustomer = setup.customer;
    jwt = generateJWT(testUser.userId);
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId, testCustomer.id, testClock.id);
  });

  /**
   * TEST 1: Basic → Pro upgrade during trial
   * Critical: Stripe dashboard must show Pro, not Basic
   */
  test('1. Basic → Pro upgrade: Stripe shows correct plan immediately', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Basic → Pro Upgrade During Trial');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Create Basic Monthly trial subscription
    const subscription = await createTestSubscription(
      testCustomer.id,
      'price_1S8PO5RsohPcZDimYKy7PLNT', // Basic Monthly
      { userId: testUser.userId, planId: 'basic', interval: 'monthly' },
      30
    );

    console.log('✅ Step 1: Basic Monthly trial created');
    console.log(`   Subscription: ${subscription.id}`);
    console.log(`   Trial ends: ${new Date(subscription.trial_end * 1000).toISOString()}`);

    // Verify initial state
    const initialProduct = await stripe.products.retrieve(subscription.items.data[0].price.product);
    expect(initialProduct.name).toBe('Chatterforms Basic');
    
    const initialInvoices = await stripe.invoices.list({ customer: testCustomer.id, limit: 10 });
    const initialCharges = initialInvoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0);

    // Step 2: Upgrade to Pro Monthly via API
    console.log('\n✅ Step 2: Upgrading to Pro Monthly...');
    const response = await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlan: 'pro' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.newPlan).toBe('pro');

    console.log(`   API Response: ${response.data.message}`);

    // Step 3: Verify Stripe shows correct plan
    console.log('\n✅ Step 3: Verifying Stripe dashboard...');
    const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
    const currentProduct = await stripe.products.retrieve(updatedSub.items.data[0].price.product);

    console.log(`   📊 Stripe Product: ${currentProduct.name}`);
    console.log(`   📊 Price ID: ${updatedSub.items.data[0].price.id}`);
    console.log(`   📊 Status: ${updatedSub.status}`);
    console.log(`   📊 Trial end: ${new Date(updatedSub.trial_end * 1000).toISOString()}`);

    // CRITICAL ASSERTION: Stripe must show Pro, not Basic
    expect(currentProduct.name).toBe('ChatterForms Pro (HIPAA-Compliant)');
    expect(updatedSub.items.data[0].price.id).toBe('price_1S8PQaRsohPcZDim8f6xylsh');
    expect(updatedSub.status).toBe('trialing');
    expect(updatedSub.trial_end).toBe(subscription.trial_end); // Trial preserved

    // Step 4: Verify zero charges
    console.log('\n✅ Step 4: Verifying zero charges...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for invoices

    const afterInvoices = await stripe.invoices.list({ customer: testCustomer.id, limit: 10 });
    const afterCharges = afterInvoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0);
    const newCharges = afterCharges - initialCharges;

    console.log(`   💰 Initial charges: $${initialCharges / 100}`);
    console.log(`   💰 After charges: $${afterCharges / 100}`);
    console.log(`   💰 New charges: $${newCharges / 100}`);

    expect(newCharges).toBe(0); // Zero charges

    // Step 5: Verify invoice preview
    console.log('\n✅ Step 5: Verifying invoice preview...');
    const upcomingInvoice = await stripe.invoices.retrieveUpcoming({ customer: testCustomer.id });

    console.log(`   📄 Upcoming amount: $${upcomingInvoice.amount_due / 100}`);
    console.log(`   📄 Upcoming date: ${new Date(upcomingInvoice.period_end * 1000).toISOString()}`);

    expect(upcomingInvoice.amount_due).toBe(3999); // $39.99 for Pro Monthly

    // Step 6: Verify $0 invoices (expected side effect)
    const zeroInvoices = afterInvoices.data.filter(inv => inv.total === 0);
    console.log(`\n✅ Step 6: $0 invoices created: ${zeroInvoices.length} (expected)`);

    console.log('\n✅ TEST 1 PASSED: Stripe shows correct plan immediately ✅\n');
  }, 60000);

  /**
   * TEST 2: Monthly → Annual interval change during trial
   */
  test('2. Monthly → Annual interval change: Stripe shows correct interval', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Monthly → Annual Interval Change During Trial');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Create Pro Monthly trial
    const subscription = await createTestSubscription(
      testCustomer.id,
      'price_1S8PQaRsohPcZDim8f6xylsh', // Pro Monthly
      { userId: testUser.userId, planId: 'pro', interval: 'monthly' },
      30
    );

    console.log('✅ Step 1: Pro Monthly trial created');

    const initialInvoices = await stripe.invoices.list({ customer: testCustomer.id, limit: 10 });
    const initialCharges = initialInvoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0);

    // Step 2: Change to Annual
    console.log('\n✅ Step 2: Changing to Annual billing...');
    const response = await axios.post(
      `${API_URL}/api/billing/change-interval`,
      { newInterval: 'annual' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.newInterval).toBe('annual');

    console.log(`   API Response: ${response.data.message}`);

    // Step 3: Verify Stripe shows Annual
    console.log('\n✅ Step 3: Verifying Stripe dashboard...');
    const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
    const price = updatedSub.items.data[0].price;

    console.log(`   📊 Price ID: ${price.id}`);
    console.log(`   📊 Interval: ${price.recurring.interval}`);
    console.log(`   📊 Amount: $${price.unit_amount / 100}`);
    console.log(`   📊 Status: ${updatedSub.status}`);

    // CRITICAL: Stripe must show Annual interval
    expect(price.id).toBe('price_1S8PVYRsohPcZDimF5L5l38A'); // Pro Annual
    expect(price.recurring.interval).toBe('year');
    expect(price.unit_amount).toBe(38390); // $383.90
    expect(updatedSub.status).toBe('trialing');

    // Step 4: Verify zero charges
    console.log('\n✅ Step 4: Verifying zero charges...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const afterInvoices = await stripe.invoices.list({ customer: testCustomer.id, limit: 10 });
    const afterCharges = afterInvoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0);
    const newCharges = afterCharges - initialCharges;

    console.log(`   💰 New charges: $${newCharges / 100}`);
    expect(newCharges).toBe(0);

    // Step 5: Verify invoice preview
    console.log('\n✅ Step 5: Verifying invoice preview...');
    const upcomingInvoice = await stripe.invoices.retrieveUpcoming({ customer: testCustomer.id });

    console.log(`   📄 Upcoming amount: $${upcomingInvoice.amount_due / 100}`);
    expect(upcomingInvoice.amount_due).toBe(38390); // $383.90 for Pro Annual

    console.log('\n✅ TEST 2 PASSED: Stripe shows correct interval ✅\n');
  }, 60000);

  /**
   * TEST 3: Multiple changes during trial
   * Basic → Pro → Annual → Basic Annual
   */
  test('3. Multiple changes: Each change shows correctly in Stripe', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Multiple Changes During Trial');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Start with Basic Monthly trial
    let subscription = await createTestSubscription(
      testCustomer.id,
      'price_1S8PO5RsohPcZDimYKy7PLNT',
      { userId: testUser.userId, planId: 'basic', interval: 'monthly' },
      30
    );

    console.log('✅ Step 1: Basic Monthly trial created');
    const trialEnd = subscription.trial_end;

    // Track charges
    const getCharges = async () => {
      const invoices = await stripe.invoices.list({ customer: testCustomer.id, limit: 20 });
      return invoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0);
    };

    const initialCharges = await getCharges();

    // Step 2: Upgrade to Pro Monthly
    console.log('\n✅ Step 2: Upgrading to Pro Monthly...');
    await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlan: 'pro' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    subscription = await stripe.subscriptions.retrieve(subscription.id);
    let product = await stripe.products.retrieve(subscription.items.data[0].price.product);

    console.log(`   📊 Stripe shows: ${product.name}`);
    expect(product.name).toBe('ChatterForms Pro (HIPAA-Compliant)');
    expect(subscription.items.data[0].price.id).toBe('price_1S8PQaRsohPcZDim8f6xylsh');

    // Step 3: Change to Annual
    console.log('\n✅ Step 3: Changing to Annual billing...');
    await axios.post(
      `${API_URL}/api/billing/change-interval`,
      { newInterval: 'annual' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    subscription = await stripe.subscriptions.retrieve(subscription.id);
    console.log(`   📊 Stripe shows: ${subscription.items.data[0].price.recurring.interval} billing`);
    expect(subscription.items.data[0].price.id).toBe('price_1S8PVYRsohPcZDimF5L5l38A');
    expect(subscription.items.data[0].price.recurring.interval).toBe('year');

    // Step 4: Downgrade to Basic Annual
    console.log('\n✅ Step 4: Downgrading to Basic Annual...');
    await axios.post(
      `${API_URL}/api/billing/change-plan`,
      { newPlan: 'basic' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    subscription = await stripe.subscriptions.retrieve(subscription.id);
    product = await stripe.products.retrieve(subscription.items.data[0].price.product);

    console.log(`   📊 Stripe shows: ${product.name} (${subscription.items.data[0].price.recurring.interval})`);
    expect(product.name).toBe('Chatterforms Basic');
    expect(subscription.items.data[0].price.id).toBe('price_1S8PO5RsohPcZDim7N1h7kSM');
    expect(subscription.items.data[0].price.recurring.interval).toBe('year');

    // Final verification
    console.log('\n✅ Final Verification:');
    const finalCharges = await getCharges();
    const totalNewCharges = finalCharges - initialCharges;

    console.log(`   💰 Total charges: $${totalNewCharges / 100}`);
    console.log(`   📊 Trial preserved: ${subscription.trial_end === trialEnd ? 'YES' : 'NO'}`);
    console.log(`   📊 Status: ${subscription.status}`);

    expect(totalNewCharges).toBe(0); // Still zero charges
    expect(subscription.trial_end).toBe(trialEnd); // Trial still preserved
    expect(subscription.status).toBe('trialing');

    console.log('\n✅ TEST 3 PASSED: All changes reflected correctly in Stripe ✅\n');
  }, 90000);

  /**
   * TEST 4: UI Data Validation - /subscription endpoint
   */
  test('4. UI Data Validation: /subscription returns correct data', async () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: UI Data Validation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create Pro Monthly trial
    const subscription = await createTestSubscription(
      testCustomer.id,
      'price_1S8PQaRsohPcZDim8f6xylsh',
      { userId: testUser.userId, planId: 'pro', interval: 'monthly' },
      30
    );

    console.log('✅ Step 1: Pro Monthly trial created');

    // Upgrade to Pro Annual
    console.log('\n✅ Step 2: Changing to Annual...');
    await axios.post(
      `${API_URL}/api/billing/change-interval`,
      { newInterval: 'annual' },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    // Get subscription data from API
    console.log('\n✅ Step 3: Fetching subscription data from /subscription endpoint...');
    const response = await axios.get(
      `${API_URL}/api/billing/subscription`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    expect(response.status).toBe(200);
    const subData = response.data;

    console.log('\n📊 UI Data Received:');
    console.log(`   Plan: ${subData.plan}`);
    console.log(`   Interval: ${subData.interval}`);
    console.log(`   Status: ${subData.status}`);
    console.log(`   Is Trial: ${subData.isTrial}`);
    console.log(`   Trial End: ${subData.trialEnd ? new Date(subData.trialEnd * 1000).toISOString() : 'N/A'}`);
    console.log(`   Current Period End: ${new Date(subData.currentPeriodEnd * 1000).toISOString()}`);
    console.log(`   HIPAA Enabled: ${subData.hipaaEnabled}`);
    console.log(`   Scheduled Change: ${subData.scheduledChange ? 'YES' : 'NO'}`);

    // Validate UI data
    expect(subData.plan).toBe('pro');
    expect(subData.interval).toBe('annual');
    expect(subData.status).toBe('trialing');
    expect(subData.isTrial).toBe(true);
    expect(subData.trialEnd).toBe(subscription.trial_end);
    expect(subData.hipaaEnabled).toBe(true);
    expect(subData.scheduledChange).toBeNull(); // No scheduled change with direct updates

    // Verify Stripe data matches UI data
    console.log('\n✅ Step 4: Verifying Stripe data matches UI data...');
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);

    expect(stripeSub.items.data[0].price.id).toBe('price_1S8PVYRsohPcZDimF5L5l38A'); // Pro Annual
    expect(stripeSub.metadata.planId).toBe(subData.plan);
    expect(stripeSub.metadata.interval).toBe(subData.interval);
    expect(stripeSub.status).toBe(subData.status);
    expect(stripeSub.trial_end).toBe(subData.trialEnd);

    console.log('   ✅ Stripe items match UI data');
    console.log('   ✅ Stripe metadata matches UI data');
    console.log('   ✅ No mismatch between items and metadata');

    console.log('\n✅ TEST 4 PASSED: UI data validation successful ✅\n');
  }, 60000);
});

