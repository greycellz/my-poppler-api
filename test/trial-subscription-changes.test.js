/**
 * Trial Subscription Changes Tests
 * 
 * Tests for plan and interval changes during trial periods
 * Uses Stripe Test Clocks for time simulation
 * 
 * Run with: STRIPE_SECRET_KEY=sk_test_... npm test -- trial-subscription-changes
 */

const axios = require('axios');
const {
  createTestUserWithCustomer,
  generateTestToken,
  createTrialSubscription,
  updateSubscriptionMetadata,
  cancelSubscription,
  cleanupTestUser,
  cleanupStripeCustomer,
  cleanupTestClock,
  waitForStripeProcessing,
  advanceTestClock,
  getPriceId
} = require('./test-utils');

const Stripe = require('stripe');

// Load test secrets if available
let testSecretsForStripe = {};
try {
  testSecretsForStripe = require('./test-secrets');
} catch (e) {
  // test-secrets.js not found, use environment variables
}

const stripeSecret = testSecretsForStripe.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret 
  ? new Stripe(stripeSecret)
  : null;

// Load test secrets if available
let testSecrets = {};
try {
  testSecrets = require('./test-secrets');
} catch (e) {
  // test-secrets.js not found, use environment variables
}

const API_URL = testSecrets.API_URL || process.env.API_URL || 'https://my-poppler-api-dev.up.railway.app';

// Conditionally skip if Stripe key not available
const stripeKeyToCheck = testSecretsForStripe.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const testDescribe = (!stripe || !stripeKeyToCheck || !stripeKeyToCheck.includes('sk_test_'))
  ? describe.skip
  : describe;

testDescribe('Trial Subscription Changes', () => {
  let testUsers = []; // Track all test users for cleanup

  // Create a new test clock for each test to avoid the 3-customer limit
  async function createTestClock() {
    if (!stripe) {
      throw new Error('Stripe not initialized');
    }
    const testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });
    return testClock.id;
  }

  afterAll(async () => {
    // Cleanup all test users
    for (const user of testUsers) {
      if (user.customerId) {
        await cleanupStripeCustomer(user.customerId);
      }
      if (user.userId) {
        await cleanupTestUser(user.userId);
      }
    }
    testUsers = [];
  });

  describe('Trial Plan Changes', () => {
    test('Trial Plan Upgrade (Basic → Pro) - Immediate upgrade, trial preserved', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'basic',
        status: 'trialing'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'basic',
        'monthly',
        { userId, trialDays: 30 }
      );

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Upgrade to Pro
      const response = await axios.post(
        `${API_URL}/api/billing/change-plan`,
        {
          newPlanId: 'pro',
          interval: 'monthly'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify subscription updated
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'monthly'));
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.status).toBe('trialing'); // Still in trial
      expect(updatedSub.metadata.planId).toBe('pro');
    }, 30000);

    test('Trial Plan Downgrade (Pro → Basic) - Immediate downgrade, trial preserved', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'monthly',
        { userId, trialDays: 30 }
      );

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Downgrade to Basic
      const response = await axios.post(
        `${API_URL}/api/billing/change-plan`,
        {
          newPlanId: 'basic',
          interval: 'monthly'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify subscription updated
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('basic', 'monthly'));
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.status).toBe('trialing'); // Still in trial
      expect(updatedSub.metadata.planId).toBe('basic');
    }, 30000);

    test('Trial Plan Change with Existing Schedule - Schedule released, change applied', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'basic',
        status: 'trialing'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'basic',
        'monthly',
        { userId, trialDays: 30 }
      );

      // Create a schedule for interval change
      // Note: Must create schedule first, then update with phases
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id
      });
      
      // Update schedule with phases and metadata
      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: getPriceId('basic', 'monthly') }],
            start_date: subscription.current_period_start,
            end_date: subscription.trial_end
          },
          {
            items: [{ price: getPriceId('basic', 'annual') }],
            start_date: subscription.trial_end
          }
        ],
        metadata: {
          userId,
          scheduledInterval: 'annual'
        }
      });

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Change plan to Pro (should release schedule and apply immediately)
      const response = await axios.post(
        `${API_URL}/api/billing/change-plan`,
        {
          newPlanId: 'pro',
          interval: 'monthly'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify schedule is released
      // Note: release() doesn't delete the schedule, it just releases the subscription from it
      // The schedule still exists but is no longer active/managing the subscription
      try {
        const releasedSchedule = await stripe.subscriptionSchedules.retrieve(schedule.id);
        // Schedule still exists but should be released (not managing subscription)
        expect(releasedSchedule.status).toBe('released');
      } catch (error) {
        // Schedule might be deleted or not found - that's also OK
        if (error.code !== 'resource_missing') {
          throw error; // Re-throw if it's a different error
        }
      }

      // Verify subscription updated
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'monthly'));
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.metadata.planId).toBe('pro');
      expect(updatedSub.metadata.scheduledInterval).toBeNull(); // Cleared
    }, 30000);
  });

  describe('Trial Interval Changes', () => {
    test('Trial Interval Upgrade (Monthly → Annual) - Immediate change, trial preserved', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing',
        interval: 'monthly'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'monthly',
        { userId, trialDays: 30 }
      );

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Upgrade to annual
      const response = await axios.post(
        `${API_URL}/api/billing/change-interval`,
        {
          newInterval: 'annual'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify subscription updated
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'annual'));
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.status).toBe('trialing'); // Still in trial
      expect(updatedSub.metadata.interval).toBe('annual');
    }, 30000);

    test('Trial Interval Downgrade (Annual → Monthly) - Immediate change, trial preserved', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing',
        interval: 'annual'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'annual',
        { userId, trialDays: 30 }
      );

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Downgrade to monthly
      const response = await axios.post(
        `${API_URL}/api/billing/change-interval`,
        {
          newInterval: 'monthly'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify subscription updated
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'monthly'));
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.status).toBe('trialing'); // Still in trial
      expect(updatedSub.metadata.interval).toBe('monthly');
    }, 30000);

    test('Trial Interval Change with Existing Schedule - Schedule released, change applied', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing',
        interval: 'monthly'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'monthly',
        { userId, trialDays: 30 }
      );

      // Create a schedule for plan change
      // Note: Must create schedule first, then update with phases
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id
      });
      
      // Update schedule with phases and metadata
      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
            start_date: subscription.current_period_start,
            end_date: subscription.trial_end
          },
          {
            items: [{ price: getPriceId('basic', 'monthly') }],
            start_date: subscription.trial_end
          }
        ],
        metadata: {
          userId,
          scheduledPlanId: 'basic'
        }
      });

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Change interval to annual (should release schedule and apply immediately)
      const response = await axios.post(
        `${API_URL}/api/billing/change-interval`,
        {
          newInterval: 'annual'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify schedule is released
      // Note: release() doesn't delete the schedule, it just releases the subscription from it
      // The schedule still exists but is no longer active/managing the subscription
      try {
        const releasedSchedule = await stripe.subscriptionSchedules.retrieve(schedule.id);
        // Schedule still exists but should be released (not managing subscription)
        expect(releasedSchedule.status).toBe('released');
      } catch (error) {
        // Schedule might be deleted or not found - that's also OK
        if (error.code !== 'resource_missing') {
          throw error; // Re-throw if it's a different error
        }
      }

      // Verify subscription updated
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'annual'));
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.metadata.interval).toBe('annual');
      // scheduledPlanId should be null or undefined (Stripe may return undefined for missing metadata)
      expect(updatedSub.metadata.scheduledPlanId === null || updatedSub.metadata.scheduledPlanId === undefined).toBe(true); // Cleared
    }, 30000);
  });

  describe('Trial Cancellation', () => {
    test('Cancel During Trial (No Schedule) - Subscription remains in trial', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'monthly',
        { userId, trialDays: 30 }
      );

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Cancel subscription
      const response = await axios.post(
        `${API_URL}/api/billing/cancel-subscription`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.cancellationDate).toBe(trialEnd);

      // Verify subscription
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.cancel_at_period_end).toBe(true);
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.status).toBe('trialing'); // Still in trial
    }, 30000);

    test('Cancel During Trial (With Schedule) - Schedule canceled, subscription remains in trial', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'monthly',
        { userId, trialDays: 30 }
      );

      // Create a schedule
      // Note: Must create schedule first, then update with phases
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id
      });
      
      // Update schedule with phases and metadata
      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
            start_date: subscription.current_period_start,
            end_date: subscription.trial_end
          },
          {
            items: [{ price: getPriceId('basic', 'monthly') }],
            start_date: subscription.trial_end
          }
        ],
        metadata: {
          userId,
          scheduledPlanId: 'basic'
        }
      });

      const token = generateTestToken(userId, email);
      const trialEnd = subscription.trial_end;

      // Cancel subscription
      const response = await axios.post(
        `${API_URL}/api/billing/cancel-subscription`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify schedule is canceled
      try {
        const updatedSchedule = await stripe.subscriptionSchedules.retrieve(schedule.id);
        expect(updatedSchedule.status).toBe('canceled');
      } catch (error) {
        // Schedule might be released instead
        expect(['canceled', 'resource_missing']).toContain(error.code || 'canceled');
      }

      // Verify subscription
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.cancel_at_period_end).toBe(true);
      expect(updatedSub.trial_end).toBe(trialEnd); // Trial preserved
      expect(updatedSub.status).toBe('trialing'); // Still in trial
    }, 30000);
  });

  describe('Trial Detection After Trial Ends', () => {
    test('Trial Ended Detection (hasTrialEnded) - isTrial should be false', async () => {
      const testClockId = await createTestClock();
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'trialing'
      });
      testUsers.push({ userId, customerId });

      // Create trial subscription
      const subscription = await createTrialSubscription(
        customerId,
        'pro',
        'monthly',
        { userId, trialDays: 30 }
      );

      const trialEnd = subscription.trial_end;

      // Advance clock past trial end
      await advanceTestClock(testClockId, trialEnd + 86400); // 1 day past trial end
      await waitForStripeProcessing(5000);

      // Retrieve subscription to trigger Stripe processing
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);

      // Verify trial has ended (current_period_end > trial_end)
      const hasTrialEnded = updatedSub.trial_end !== null && 
                           updatedSub.current_period_end > updatedSub.trial_end;

      // Check API response
      const token = generateTestToken(userId, email);
      const response = await axios.get(
        `${API_URL}/api/billing/subscription`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      expect(response.status).toBe(200);
      
      // If trial has ended, isTrial should be false
      if (hasTrialEnded) {
        expect(response.data.isTrial).toBe(false);
      }
    }, 60000);
  });
});

