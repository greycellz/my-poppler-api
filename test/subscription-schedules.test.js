/**
 * Subscription Schedule Handling Tests
 * 
 * Tests for schedule creation, updates, and releases
 * Covers scenarios with existing schedules
 * 
 * Run with: STRIPE_SECRET_KEY=sk_test_... npm test -- subscription-schedules
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

testDescribe('Subscription Schedule Handling', () => {
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

  describe('Plan Downgrade with Existing Schedule', () => {
    test('Plan Downgrade (No Schedule) - Creates new schedule', async () => {
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

      // Verify schedule created
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.schedule).toBeDefined();

      const schedule = await stripe.subscriptionSchedules.retrieve(updatedSub.schedule);
      expect(schedule.phases.length).toBeGreaterThan(1);
      expect(schedule.phases[schedule.phases.length - 1].items[0].price.id).toBe(getPriceId('basic', 'monthly'));
    }, 30000);

    test('Plan Downgrade (With Existing Schedule) - Updates existing schedule', async () => {
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

      // Create initial schedule for interval change
      const initialSchedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'monthly') }],
            start_date: Math.floor(Date.now() / 1000),
            end_date: subscription.current_period_end
          },
          {
            items: [{ price: getPriceId('pro', 'annual') }],
            start_date: subscription.current_period_end
          }
        ],
        metadata: {
          userId,
          scheduledInterval: 'annual'
        }
      });

      const token = generateTestToken(userId, email);

      // Downgrade to Basic (should update existing schedule)
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

      // Verify same schedule ID (updated, not new one)
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.schedule).toBe(initialSchedule.id);

      // Verify schedule phases updated
      const updatedSchedule = await stripe.subscriptionSchedules.retrieve(initialSchedule.id);
      expect(updatedSchedule.phases.length).toBeGreaterThan(1);
      
      // Last phase should have Basic plan
      const lastPhase = updatedSchedule.phases[updatedSchedule.phases.length - 1];
      expect(lastPhase.items[0].price.id).toBe(getPriceId('basic', 'monthly'));
    }, 30000);
  });

  describe('Interval Downgrade with Existing Schedule', () => {
    test('Interval Downgrade (No Schedule) - Creates new schedule', async () => {
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

      // Verify schedule created
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.schedule).toBeDefined();

      // Verify current period end preserved
      expect(updatedSub.current_period_end).toBe(currentPeriodEnd);
    }, 30000);

    test('Interval Downgrade (With Existing Schedule) - Updates existing schedule', async () => {
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

      // Create initial schedule for plan change
      const initialSchedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('pro', 'annual') }],
            start_date: Math.floor(Date.now() / 1000),
            end_date: subscription.current_period_end
          },
          {
            items: [{ price: getPriceId('basic', 'annual') }],
            start_date: subscription.current_period_end
          }
        ],
        metadata: {
          userId,
          scheduledPlanId: 'basic'
        }
      });

      const token = generateTestToken(userId, email);

      // Downgrade to monthly (should update existing schedule)
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

      // Verify same schedule ID (updated, not new one)
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.schedule).toBe(initialSchedule.id);

      // Verify schedule phases updated
      const updatedSchedule = await stripe.subscriptionSchedules.retrieve(initialSchedule.id);
      expect(updatedSchedule.phases.length).toBeGreaterThan(1);
      
      // Last phase should have monthly interval
      const lastPhase = updatedSchedule.phases[updatedSchedule.phases.length - 1];
      expect(lastPhase.items[0].price.id).toBe(getPriceId('basic', 'monthly'));
    }, 30000);
  });

  describe('Multiple Schedule Updates', () => {
    test('Plan Downgrade → Interval Change → Plan Change - All updates same schedule', async () => {
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

      // Step 1: Downgrade plan (creates schedule)
      const response1 = await axios.post(
        `${API_URL}/api/billing/change-plan`,
        {
          newPlanId: 'basic',
          interval: 'annual'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      expect(response1.status).toBe(200);
      const updatedSub1 = await stripe.subscriptions.retrieve(subscription.id);
      const scheduleId1 = updatedSub1.schedule;
      expect(scheduleId1).toBeDefined();

      // Step 2: Change interval (updates schedule)
      const response2 = await axios.post(
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

      expect(response2.status).toBe(200);
      const updatedSub2 = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub2.schedule).toBe(scheduleId1); // Same schedule

      // Step 3: Change plan again (updates schedule)
      const response3 = await axios.post(
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

      expect(response3.status).toBe(200);
      const updatedSub3 = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub3.schedule).toBe(scheduleId1); // Same schedule

      // Verify final schedule state
      const finalSchedule = await stripe.subscriptionSchedules.retrieve(scheduleId1);
      expect(finalSchedule.phases.length).toBeGreaterThan(1);
      
      // Last phase should have Pro monthly
      const lastPhase = finalSchedule.phases[finalSchedule.phases.length - 1];
      expect(lastPhase.items[0].price.id).toBe(getPriceId('pro', 'monthly'));
    }, 60000);
  });

  describe('Schedule Release Scenarios', () => {
    test('Release Schedule During Upgrade - Immediate upgrade applied', async () => {
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

      // Create schedule for downgrade
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            items: [{ price: getPriceId('basic', 'monthly') }],
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
          scheduledPlanId: 'pro'
        }
      });

      const token = generateTestToken(userId, email);

      // Upgrade to Pro (should release schedule and apply immediately)
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
      try {
        await stripe.subscriptionSchedules.retrieve(schedule.id);
        expect(true).toBe(false);
      } catch (error) {
        expect(error.code).toBe('resource_missing');
      }

      // Verify subscription updated immediately
      const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
      expect(updatedSub.items.data[0].price.id).toBe(getPriceId('pro', 'monthly'));
      expect(updatedSub.metadata.planId).toBe('pro');
    }, 30000);
  });
});

