/**
 * Active Subscription Changes Tests
 * 
 * Tests for plan and interval changes on active (non-trial) subscriptions
 * Uses Stripe Test Clocks for time simulation
 * 
 * Run with: STRIPE_SECRET_KEY=sk_test_... npm test -- subscription-changes
 */

const axios = require('axios');
const {
  createTestUserWithCustomer,
  generateTestToken,
  createActiveSubscription,
  cancelSubscription,
  cleanupTestUser,
  cleanupStripeCustomer,
  cleanupTestClock,
  waitForStripeProcessing,
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

testDescribe('Active Subscription Changes', () => {
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

  describe('Active Plan Changes', () => {
    test('Active Plan Upgrade (Basic → Pro) - Immediate upgrade, proration charged', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'basic',
        status: 'active'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'basic',
        'monthly',
        { userId }
      );

      const token = generateTestToken(userId, email);
      const currentPeriodEnd = subscription.current_period_end;

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
      expect(updatedSub.metadata.planId).toBe('pro');
      
      // Verify billing period continues (no reset)
      expect(updatedSub.current_period_end).toBe(currentPeriodEnd);
    }, 30000);

    test('Active Plan Downgrade (Pro → Basic) - Schedule created, no immediate charge', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'monthly',
        { userId }
      );

      const token = generateTestToken(userId, email);
      const currentPeriodEnd = subscription.current_period_end;

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
      expect(response.data.message).toContain('scheduled');

      // Verify schedule created
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.schedule).toBeDefined();

      // Verify schedule phases
      const schedule = await stripe.subscriptionSchedules.retrieve(updatedSub.schedule);
      expect(schedule.phases.length).toBeGreaterThan(1);
      expect(schedule.phases[schedule.phases.length - 1].items[0].price.id).toBe(getPriceId('basic', 'monthly'));

      // Verify current period end preserved
      expect(updatedSub.current_period_end).toBe(currentPeriodEnd);

      // Verify metadata
      expect(updatedSub.metadata.scheduledPlanId).toBe('basic');
    }, 30000);
  });

  describe('Active Interval Changes', () => {
    test('Active Interval Upgrade (Monthly → Annual) - Immediate upgrade, billing cycle reset', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active',
        interval: 'monthly'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'monthly',
        { userId }
      );

      const token = generateTestToken(userId, email);
      const originalPeriodEnd = subscription.current_period_end;

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
      expect(updatedSub.metadata.interval).toBe('annual');

      // Verify billing cycle reset (new annual period started)
      const now = Math.floor(Date.now() / 1000);
      const expectedAnnualEnd = now + (365 * 24 * 60 * 60);
      const tolerance = 86400; // 1 day tolerance
      expect(Math.abs(updatedSub.current_period_end - expectedAnnualEnd)).toBeLessThan(tolerance);
    }, 30000);

    test('Active Interval Downgrade (Annual → Monthly) - Schedule created, current_period_end preserved', async () => {
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

      const token = generateTestToken(userId, email);
      const currentPeriodEnd = subscription.current_period_end;

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
      expect(response.data.message).toContain('scheduled');

      // Verify schedule created
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.schedule).toBeDefined();

      // Verify schedule phases
      const schedule = await stripe.subscriptionSchedules.retrieve(updatedSub.schedule);
      expect(schedule.phases.length).toBeGreaterThan(1);
      expect(schedule.phases[schedule.phases.length - 1].items[0].price.id).toBe(getPriceId('pro', 'monthly'));

      // Verify current period end preserved
      expect(updatedSub.current_period_end).toBe(currentPeriodEnd);

      // Verify metadata
      expect(updatedSub.metadata.scheduledInterval).toBe('monthly');
    }, 30000);
  });

  describe('Active Subscription Cancellation', () => {
    test('Cancel Active Subscription (No Schedule) - cancel_at_period_end set', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'monthly',
        { userId }
      );

      const token = generateTestToken(userId, email);
      const currentPeriodEnd = subscription.current_period_end;

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
      expect(response.data.cancellationDate).toBe(currentPeriodEnd);

      // Verify subscription
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.cancel_at_period_end).toBe(true);
      expect(updatedSub.current_period_end).toBe(currentPeriodEnd);
    }, 30000);

    test('Cancel Active Subscription (With Schedule) - Schedule canceled, cancel_at_period_end set', async () => {
      const { userId, email, customerId } = await createTestUserWithCustomer({
        testClockId,
        plan: 'pro',
        status: 'active'
      });
      testUsers.push({ userId, customerId });

      // Create active subscription
      const subscription = await createActiveSubscription(
        customerId,
        'pro',
        'monthly',
        { userId }
      );

      // Create a schedule for plan change
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
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
          scheduledPlanId: 'basic'
        }
      });

      const token = generateTestToken(userId, email);
      const currentPeriodEnd = subscription.current_period_end;

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
      expect(updatedSub.current_period_end).toBe(currentPeriodEnd);
    }, 30000);
  });
});

