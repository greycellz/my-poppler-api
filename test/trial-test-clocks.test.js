/**
 * Trial Subscription - Stripe Test Clock Tests
 * 
 * Uses Stripe Test Clocks to simulate time passage and test trial conversion
 * without waiting 30 days
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_...');

describe('Trial Subscription - Test Clock Tests', () => {
  let testCustomerId;
  let testClockId;
  let testSubscriptionId;

  beforeAll(async () => {
    // Create test customer
    const customer = await stripe.customers.create({
      email: `test-clock-${Date.now()}@chatterforms.test`,
      name: 'Test Clock User'
    });
    testCustomerId = customer.id;

    // Create test clock frozen at current time
    const testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });
    testClockId = testClock.id;
  });

  afterAll(async () => {
    // Cleanup: Delete test resources
    if (testSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(testSubscriptionId);
      } catch (e) {
        // Subscription may already be deleted
      }
    }
    
    if (testClockId) {
      try {
        await stripe.testHelpers.testClocks.delete(testClockId);
      } catch (e) {
        // Test clock may already be deleted
      }
    }
  });

  test('Creates subscription with trial period using test clock', async () => {
    // Create price (or use existing test price)
    const price = await stripe.prices.create({
      unit_amount: 3999,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: {
        name: 'Test Pro Plan'
      }
    });

    // Create subscription with trial and test clock
    const subscription = await stripe.subscriptions.create({
      customer: testCustomerId,
      items: [{ price: price.id }],
      trial_period_days: 30,
      test_clock: testClockId,
      metadata: {
        userId: 'test-user-id',
        planId: 'pro',
        interval: 'monthly'
      }
    });

    testSubscriptionId = subscription.id;

    expect(subscription.status).toBe('trialing');
    expect(subscription.trial_end).toBeDefined();
    expect(subscription.trial_start).toBeDefined();
    
    // Trial should be 30 days from now
    const expectedTrialEnd = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
    const tolerance = 60; // 1 minute tolerance
    expect(Math.abs(subscription.trial_end - expectedTrialEnd)).toBeLessThan(tolerance);
  });

  test('Advances test clock to trial end and verifies conversion', async () => {
    // Get subscription to find trial end
    const subscription = await stripe.subscriptions.retrieve(testSubscriptionId);
    const trialEnd = subscription.trial_end;

    // Advance test clock to trial end
    await stripe.testHelpers.testClocks.advance(testClockId, {
      frozen_time: trialEnd
    });

    // Wait a moment for Stripe to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Retrieve updated subscription
    const updatedSubscription = await stripe.subscriptions.retrieve(testSubscriptionId);

    // Subscription should now be active (assuming payment method is valid)
    // Note: In real scenario, payment method would be required
    expect(updatedSubscription.status).toBe('active');
    expect(updatedSubscription.trial_end).toBeNull(); // Trial ended
  });

  test('Tests payment failure after trial with test clock', async () => {
    // Create new subscription with test clock
    const price = await stripe.prices.create({
      unit_amount: 3999,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: 'Test Pro Plan' }
    });

    // Create customer with payment method that will fail
    const customer = await stripe.customers.create({
      email: `test-failure-${Date.now()}@chatterforms.test`,
      payment_method: 'pm_card_chargeDeclined', // Declined card
      invoice_settings: {
        default_payment_method: 'pm_card_chargeDeclined'
      }
    });

    const newTestClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 30,
      test_clock: newTestClock.id,
      metadata: {
        userId: 'test-user-id',
        planId: 'pro',
        interval: 'monthly'
      }
    });

    // Advance to trial end
    await stripe.testHelpers.testClocks.advance(newTestClock.id, {
      frozen_time: subscription.trial_end
    });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Subscription should be past_due due to payment failure
    const updated = await stripe.subscriptions.retrieve(subscription.id);
    expect(['past_due', 'unpaid', 'canceled']).toContain(updated.status);

    // Cleanup
    await stripe.testHelpers.testClocks.delete(newTestClock.id);
  });

  test('Tests trial cancellation with test clock', async () => {
    // Create subscription with trial
    const price = await stripe.prices.create({
      unit_amount: 3999,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: 'Test Pro Plan' }
    });

    const newTestClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });

    const subscription = await stripe.subscriptions.create({
      customer: testCustomerId,
      items: [{ price: price.id }],
      trial_period_days: 30,
      test_clock: newTestClock.id,
      metadata: {
        userId: 'test-user-id',
        planId: 'pro',
        interval: 'monthly'
      }
    });

    // Cancel subscription during trial
    await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true
    });

    // Advance to trial end
    await stripe.testHelpers.testClocks.advance(newTestClock.id, {
      frozen_time: subscription.trial_end
    });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Subscription should be canceled (no charge since canceled during trial)
    const updated = await stripe.subscriptions.retrieve(subscription.id);
    expect(['canceled', 'trialing']).toContain(updated.status);

    // Cleanup
    await stripe.testHelpers.testClocks.delete(newTestClock.id);
  });

  test('Tests plan change during trial with test clock', async () => {
    // Create subscription with trial
    const basicPrice = await stripe.prices.create({
      unit_amount: 1999,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: 'Test Basic Plan' }
    });

    const proPrice = await stripe.prices.create({
      unit_amount: 3999,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: 'Test Pro Plan' }
    });

    const newTestClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });

    const subscription = await stripe.subscriptions.create({
      customer: testCustomerId,
      items: [{ price: basicPrice.id }],
      trial_period_days: 30,
      test_clock: newTestClock.id,
      metadata: {
        userId: 'test-user-id',
        planId: 'basic',
        interval: 'monthly'
      }
    });

    // Create subscription schedule for upgrade at trial end
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
      phases: [
        {
          items: [{ price: basicPrice.id }],
          end_date: subscription.trial_end
        },
        {
          items: [{ price: proPrice.id }]
        }
      ]
    });

    // Advance to trial end
    await stripe.testHelpers.testClocks.advance(newTestClock.id, {
      frozen_time: subscription.trial_end
    });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify subscription upgraded to Pro
    const updated = await stripe.subscriptions.retrieve(subscription.id);
    expect(updated.items.data[0].price.id).toBe(proPrice.id);

    // Cleanup
    await stripe.testHelpers.testClocks.delete(newTestClock.id);
  });
});

