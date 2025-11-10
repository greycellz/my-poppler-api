/**
 * Subscription Edge Cases Tests
 * 
 * Tests for edge cases in subscription management:
 * - Cancel scheduled interval change
 * - Multiple schedule interactions
 * - Trial detection with schedules
 * 
 * Run with: STRIPE_SECRET_KEY=sk_test_... npm test -- subscription-edge-cases
 */

const axios = require('axios');
const {
  createTestUserWithCustomer,
  generateTestToken,
  createActiveSubscription,
  createTrialSubscription,
  cleanupTestUser,
  cleanupStripeCustomer,
  cleanupTestClock,
  getPriceId
} = require('./test-utils');

const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const API_URL = process.env.API_URL || 'https://my-poppler-api-dev.up.railway.app';

// Conditionally skip if Stripe key not available
const testDescribe = (!stripe || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_SECRET_KEY.includes('sk_test_'))
  ? describe.skip
  : describe;

testDescribe('Subscription Edge Cases', () => {
  let testClockId;
  let testUsers = [];

  beforeAll(async () => {
    if (!stripe) {
      console.log('⚠️  Skipping - Stripe not initialized');
      return;
    }

    // Create test clock frozen at current time
    const testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000)
    });
    testClockId = testClock.id;
  });

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

  describe('Cancel Scheduled Interval Change', () => {
    test('Cancel Scheduled Monthly Change (Annual → Annual) - Schedule released, metadata cleared', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active',
        interval: 'annual'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'annual',
        { userId }
      );

      // Create schedule for monthly change
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'annual') }],
            start_date: Math.floor(Date.now() / 1000),
            end_date: subscription.current_period_end
          },
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
            start_date: subscription.current_period_end
          }
        ],
        metadata: {
          userId,
          scheduledInterval: 'monthly'
        }
      });

      // Update subscription metadata to reflect scheduled change
      await stripe.subscriptions.update(subscription.id, {
        metadata: {
          userId,
          planId: 'pro',
          interval: 'annual',
          scheduledInterval: 'monthly'
        }
      });

      const token = generateTestToken(userId, email);

      // Request change back to annual (should cancel scheduled change)
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
      expect(response.data.message).toContain('canceled');

      // Verify schedule is released
      try {
        await stripe.subscriptionSchedules.retrieve(schedule.id);
        expect(true).toBe(false);
      } catch (error) {
        expect(error.code).toBe('resource_missing');
      }

      // Verify metadata cleared
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.metadata.scheduledInterval).toBeNull();
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'annual'));
    }, 30000);

    test('Cancel Scheduled Change with Plan Change - Both changes canceled', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active',
        interval: 'annual'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'annual',
        { userId }
      );

      // Create schedule with both plan and interval changes
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'annual') }],
            start_date: Math.floor(Date.now() / 1000),
            end_date: subscription.current_period_end
          },
          {
            items: [{ price: getPriceId('basic', 'monthly') }],
            start_date: subscription.current_period_end
          }
        ],
        metadata: {
          userId,
          scheduledPlanId: 'basic',
          scheduledInterval: 'monthly'
        }
      });

      // Update subscription metadata
      await stripe.subscriptions.update(subscription.id, {
        metadata: {
          userId,
          planId: 'pro',
          interval: 'annual',
          scheduledPlanId: 'basic',
          scheduledInterval: 'monthly'
        }
      });

      const token = generateTestToken(userId, email);

      // Request change back to annual (should cancel scheduled interval change)
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

      // Verify schedule is released (both changes canceled)
      try {
        await stripe.subscriptionSchedules.retrieve(schedule.id);
        expect(true).toBe(false);
      } catch (error) {
        expect(error.code).toBe('resource_missing');
      }

      // Verify metadata cleared
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.metadata.scheduledInterval).toBeNull();
      expect(updatedSub.metadata.scheduledPlanId).toBeNull();
    }, 30000);
  });

  describe('Trial Detection with Schedules', () => {
    test('Trial with Schedule (Status: active, trial_end: future) - isTrial should be true', async () => {
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

      // Create schedule for plan change
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
            start_date: Math.floor(Date.now() / 1000),
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

      // Note: When a schedule is created, subscription status might change to 'active'
      // But trial_end should still be in the future
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);

      // Verify trial detection logic
      const now = Math.floor(Date.now() / 1000);
      const isInTrial = updatedSub.status === 'trialing' || 
                        (updatedSub.trial_end !== null && updatedSub.trial_end > now);

      expect(isInTrial).toBe(true);
      expect(updatedSub.trial_end).toBeGreaterThan(now);

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
      expect(response.data.isTrial).toBe(true);
    }, 30000);
  });

  describe('Interval Mismatch Edge Cases', () => {
    test('Request Same Interval with Scheduled Change - Should cancel scheduled change', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active',
        interval: 'annual'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'annual',
        { userId }
      );

      // Create schedule for monthly change
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'annual') }],
            start_date: Math.floor(Date.now() / 1000),
            end_date: subscription.current_period_end
          },
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
            start_date: subscription.current_period_end
          }
        ],
        metadata: {
          userId,
          scheduledInterval: 'monthly'
        }
      });

      // Update subscription metadata
      await stripe.subscriptions.update(subscription.id, {
        metadata: {
          userId,
          planId: 'pro',
          interval: 'annual',
          scheduledInterval: 'monthly'
        }
      });

      const token = generateTestToken(userId, email);

      // Request annual (same as current, but monthly is scheduled)
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
      expect(response.data.message).toContain('canceled');

      // Verify schedule released
      try {
        await stripe.subscriptionSchedules.retrieve(schedule.id);
        expect(true).toBe(false);
      } catch (error) {
        expect(error.code).toBe('resource_missing');
      }

      // Verify metadata
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.metadata.scheduledInterval).toBeNull();
    }, 30000);

    test('Request Same Interval without Scheduled Change - Should return error', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active',
        interval: 'annual'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      await createActiveSubscription(
        customerId,
        'pro',
        'annual',
        { userId }
      );

      const token = generateTestToken(userId, email);

      // Request annual (same as current, no scheduled change)
      try {
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
        // Should not succeed
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toContain('already on');
      }
    }, 30000);
  });
});

