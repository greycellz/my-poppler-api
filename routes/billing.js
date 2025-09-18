const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { authenticateToken } = require('../auth/middleware');

// Initialize Stripe with secret key
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Price ID mapping from your Stripe export
const PRICE_IDS = {
  basic: {
    monthly: 'price_1S8PK8RsohPcZDimxfsFUWrB',
    annual: 'price_1S8PO5RsohPcZDimYKy7PLNT'
  },
  pro: {
    monthly: 'price_1S8PQaRsohPcZDim8f6xylsh',
    annual: 'price_1S8PVYRsohPcZDimF5L5l38A'
  },
  enterprise: {
    monthly: 'price_1S8PbBRsohPcZDim3rN4pRNX',
    annual: 'price_1S8PbBRsohPcZDimuZvJDXY0'
  }
};

// Create checkout session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { planId, interval = 'monthly' } = req.body;
    const userId = req.user.userId;
    
    console.log('🔍 Billing debug - req.user:', req.user);
    console.log('🔍 Billing debug - userId:', userId);
    console.log('🔍 Billing debug - planId:', planId);
    console.log('🔍 Billing debug - interval:', interval);

    // Validate plan and interval
    if (!PRICE_IDS[planId] || !PRICE_IDS[planId][interval]) {
      return res.status(400).json({ error: 'Invalid plan or interval' });
    }

    const priceId = PRICE_IDS[planId][interval];
    
    // Get or create Stripe customer
    let customerId = req.user.stripeCustomerId;
    console.log('🔍 Billing debug - existing customerId:', customerId);
    
    if (!customerId) {
      console.log('🔍 Billing debug - creating new Stripe customer...');
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: {
          userId: userId
        }
      });
      customerId = customer.id;
      console.log('🔍 Billing debug - created customerId:', customerId);
      
      // Update user with Stripe customer ID
      console.log('🔍 Billing debug - updating user document with userId:', userId);
      if (!userId || userId.trim() === '') {
        throw new Error('Invalid userId: ' + userId);
      }
      
      const GCPClient = require('../gcp-client');
      const gcpClient = new GCPClient();
      await gcpClient.firestore.collection('users').doc(userId).update({
        stripeCustomerId: customerId
      });
      console.log('🔍 Billing debug - user document updated successfully');
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      metadata: {
        userId: userId,
        planId: planId,
        interval: interval
      },
      subscription_data: {
        metadata: {
          userId: userId,
          planId: planId,
          interval: interval
        }
      }
    });

    res.json({ sessionUrl: session.url });
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get checkout session details (for success page)
router.get('/checkout-session', authenticateToken, async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    // Get user's Stripe customer ID from database (JWT token doesn't include it)
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(req.user.userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (session.customer !== userData.stripeCustomerId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;

    res.json({
      session,
      subscription,
      planId,
      interval,
      customerEmail: session.customer_details.email
    });
  } catch (error) {
    console.error('Stripe session retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// Create customer portal session
router.post('/create-portal-session', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get user's Stripe customer ID from database (JWT token doesn't include it)
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const customerId = userData.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/billing`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal session error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Get user subscription status
router.get('/subscription', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get user's Stripe customer ID from database (JWT token doesn't include it)
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const customerId = userData.stripeCustomerId;

    if (!customerId) {
      return res.json({
        plan: 'free',
        status: 'active',
        hipaaEnabled: false
      });
    }

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.json({
        plan: 'free',
        status: 'active',
        hipaaEnabled: false
      });
    }

    const subscription = subscriptions.data[0];
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const scheduledPlanId = subscription.metadata.scheduledPlanId;
    const scheduledInterval = subscription.metadata.scheduledInterval;
    
    console.log('🔍 Subscription debug - metadata planId:', planId);
    console.log('🔍 Subscription debug - metadata interval:', interval);
    console.log('🔍 Subscription debug - scheduledPlanId:', scheduledPlanId);
    console.log('🔍 Subscription debug - scheduledInterval:', scheduledInterval);
    console.log('🔍 Subscription debug - current period end:', subscription.current_period_end);
    
    // Check if there's a scheduled change
    let effectivePlan = planId;
    let effectiveInterval = interval;
    let hasScheduledChange = false;
    
    if (scheduledPlanId && scheduledPlanId !== planId) {
      // There's a scheduled change - user keeps current plan until period ends
      hasScheduledChange = true;
      console.log('🔍 Subscription debug - scheduled change detected via metadata');
      console.log('🔍 Subscription debug - effective plan:', effectivePlan, effectiveInterval);
    } else {
      console.log('🔍 Subscription debug - no scheduled change, using metadata plan');
    }

    res.json({
      plan: effectivePlan, // Show current effective plan (what user has access to)
      status: subscription.status,
      interval: effectiveInterval,
      currentPeriodEnd: subscription.current_period_end,
      hipaaEnabled: effectivePlan === 'pro' || effectivePlan === 'enterprise',
      scheduledChange: hasScheduledChange ? {
        newPlan: scheduledPlanId,
        newInterval: scheduledInterval,
        effectiveDate: subscription.current_period_end
      } : null
    });
  } catch (error) {
    console.error('Stripe subscription retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve subscription' });
  }
});


// Cancel subscription
router.post('/cancel-subscription', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get user's Stripe customer ID from database
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const customerId = userData.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    // Get active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const subscription = subscriptions.data[0];
    
    // Cancel the subscription immediately
    const canceledSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: false
    });
    
    await stripe.subscriptions.cancel(subscription.id);

    res.json({ 
      success: true, 
      message: 'Subscription canceled successfully',
      subscription: canceledSubscription
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Change subscription plan
router.post('/change-plan', authenticateToken, async (req, res) => {
  try {
    const { newPlanId, interval = 'monthly' } = req.body;
    const userId = req.user.userId;
    
    // Validate plan and interval
    if (!PRICE_IDS[newPlanId] || !PRICE_IDS[newPlanId][interval]) {
      return res.status(400).json({ error: 'Invalid plan or interval' });
    }

    // Get user's Stripe customer ID from database
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const customerId = userData.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    // Get active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const subscription = subscriptions.data[0];
    const newPriceId = PRICE_IDS[newPlanId][interval];
    
    // For downgrades, use subscription schedules to change at end of period
    // For upgrades, use immediate change with proration
    const isDowngrade = (planId === 'pro' && newPlanId === 'basic') || 
                       (planId === 'enterprise' && (newPlanId === 'pro' || newPlanId === 'basic')) ||
                       (planId === 'pro' && newPlanId === 'basic');
    
    if (isDowngrade) {
      // Create a subscription schedule for end-of-period change
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
        phases: [
          {
            // Current phase - keep existing plan until period ends
            items: [{
              price: subscription.items.data[0].price.id,
              quantity: 1,
            }],
            end_date: subscription.current_period_end,
          },
          {
            // Next phase - new plan starts after current period
            items: [{
              price: newPriceId,
              quantity: 1,
            }],
            // No end_date means it continues indefinitely
          }
        ],
        metadata: {
          userId: userId,
          planId: newPlanId,
          interval: interval
        }
      });
      
      // Update the original subscription metadata to track the scheduled change
      const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        metadata: {
          userId: userId,
          planId: subscription.metadata.planId, // Keep current plan in metadata
          interval: subscription.metadata.interval,
          scheduledPlanId: newPlanId, // Track scheduled change
          scheduledInterval: interval,
          scheduleId: schedule.id
        }
      });
      
      res.json({ 
        success: true, 
        message: 'Plan change scheduled for end of current period',
        subscription: updatedSubscription,
        newPlan: newPlanId,
        interval: interval,
        effectiveDate: subscription.current_period_end
      });
    } else {
      // Upgrade - immediate change with proration
      const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'create_prorations', // Immediate upgrade with proration
        metadata: {
          userId: userId,
          planId: newPlanId,
          interval: interval
        }
      });

      res.json({ 
        success: true, 
        message: 'Plan upgraded successfully',
        subscription: updatedSubscription,
        newPlan: newPlanId,
        interval: interval
      });
    }

  } catch (error) {
    console.error('Change plan error:', error);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

// Change billing interval (monthly/annual)
router.post('/change-interval', authenticateToken, async (req, res) => {
  try {
    const { newInterval } = req.body;
    const userId = req.user.userId;
    
    if (!['monthly', 'annual'].includes(newInterval)) {
      return res.status(400).json({ error: 'Invalid interval. Must be monthly or annual' });
    }

    // Get user's current subscription to determine plan
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const customerId = userData.stripeCustomerId;
    const currentPlanId = userData.planId || 'basic';

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    // Validate that the plan supports the new interval
    if (!PRICE_IDS[currentPlanId] || !PRICE_IDS[currentPlanId][newInterval]) {
      return res.status(400).json({ error: `Plan ${currentPlanId} does not support ${newInterval} billing` });
    }

    // Get active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const subscription = subscriptions.data[0];
    const newPriceId = PRICE_IDS[currentPlanId][newInterval];
    
    // Update subscription with new interval - schedule change for end of period
    const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'none', // No proration - keep current billing until period ends
      metadata: {
        userId: userId,
        planId: currentPlanId,
        interval: newInterval
      }
    });

    res.json({ 
      success: true, 
      message: `Billing changed to ${newInterval} successfully`,
      subscription: updatedSubscription,
      newInterval: newInterval
    });
  } catch (error) {
    console.error('Change interval error:', error);
    res.status(500).json({ error: 'Failed to change billing interval' });
  }
});

module.exports = router;
