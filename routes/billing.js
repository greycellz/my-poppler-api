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

// Create trial checkout session (separate endpoint for easy rollback)
router.post('/create-trial-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { planId, interval = 'monthly' } = req.body;
    const userId = req.user.userId;
    
    console.log('🔍 Trial checkout debug - userId:', userId);
    console.log('🔍 Trial checkout debug - planId:', planId);
    console.log('🔍 Trial checkout debug - interval:', interval);

    // Validate plan and interval
    if (!PRICE_IDS[planId] || !PRICE_IDS[planId][interval]) {
      return res.status(400).json({ error: 'Invalid plan or interval' });
    }

    // Check trial eligibility
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    // Check if user has had a paid subscription (not eligible for trial)
    // Note: If hasHadPaidSubscription is undefined/null/false, user is eligible for trial
    // The field will be set to true when trial converts to paid (via webhook in Phase 4)
    if (userData.hasHadPaidSubscription === true) {
      return res.status(400).json({ 
        error: 'Not eligible for trial. You have previously had a paid subscription.' 
      });
    }

    const priceId = PRICE_IDS[planId][interval];
    
    // Get or create Stripe customer
    let customerId = req.user.stripeCustomerId;
    console.log('🔍 Trial checkout debug - existing customerId:', customerId);
    
    // PHASE 8: Check for existing trialing subscriptions (prevent trial abuse)
    // Query Stripe for any existing trialing subscriptions before allowing new trial
    if (customerId) {
      const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',  // Get all statuses to find trialing subscriptions
        limit: 10
      });

      // Check if user has any trialing subscription (even if canceled_at_period_end)
      const hasTrialingSubscription = existingSubscriptions.data.some(sub => 
        sub.status === 'trialing'
      );

      if (hasTrialingSubscription) {
        return res.status(400).json({ 
          error: 'You already have an active trial. You can start a new trial after your current trial ends.' 
        });
      }
    }
    
    // NOTE: One trial per customer (not per plan)
    // User can only have ONE trial subscription total, regardless of plan
    
    if (!customerId) {
      console.log('🔍 Trial checkout debug - creating new Stripe customer...');
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: {
          userId: userId
        }
      });
      customerId = customer.id;
      console.log('🔍 Trial checkout debug - created customerId:', customerId);
      
      // Update user with Stripe customer ID
      if (!userId || userId.trim() === '') {
        throw new Error('Invalid userId: ' + userId);
      }
      
      await gcpClient.firestore.collection('users').doc(userId).update({
        stripeCustomerId: customerId
      });
      console.log('🔍 Trial checkout debug - user document updated successfully');
    }

    // Create checkout session WITH trial period
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],  // Payment method required for automatic billing
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 30,  // 30-day free trial
        trial_settings: {
          end_behavior: {
            missing_payment_method: 'cancel'  // Fallback if somehow no payment method (shouldn't happen)
          }
        },
        metadata: {
          userId: userId,
          planId: planId,
          interval: interval
        }
      },
      success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      metadata: {
        userId: userId,
        planId: planId,
        interval: interval,
        isTrial: 'true'  // Mark as trial for tracking
      }
    });

    console.log('🔍 Trial checkout debug - session created:', session.id);
    res.json({ sessionUrl: session.url });
  } catch (error) {
    console.error('Trial checkout session error:', error);
    res.status(500).json({ error: 'Failed to create trial checkout session' });
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
      customerEmail: session.customer_details.email,
      userName: userData.name || userData.email?.split('@')[0] || 'User'
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
    console.log('🔍 Portal session - userId:', userId);
    
    // Get user's Stripe customer ID from database (JWT token doesn't include it)
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    const userDoc = await gcpClient.firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log('🔍 Portal session - user not found');
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const customerId = userData.stripeCustomerId;
    console.log('🔍 Portal session - customerId:', customerId);

    if (!customerId) {
      console.log('🔍 Portal session - no customer ID found');
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

    // Get subscriptions (including trialing status)
    // CRITICAL FIX: Query must include 'trialing' status to support trial subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',  // Include all statuses to get 'trialing' subscriptions
      limit: 10  // Get more to filter
    });

    // Find active, trialing, or past_due subscription
    const subscription = subscriptions.data.find(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (!subscription) {
      return res.json({
        plan: 'free',
        status: 'active',
        hipaaEnabled: false
      });
    }

    // Check if subscription is in trial
    const isTrial = subscription.status === 'trialing';
    const trialEnd = subscription.trial_end; // Unix timestamp
    const isTrialEndingSoon = trialEnd && (trialEnd - Date.now() / 1000) < 3 * 24 * 60 * 60; // 3 days
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
      // Check if there's a mismatch between current price and metadata plan
      // This happens when proration_behavior: 'none' is used
      if (subscription.items.data.length > 0) {
        const currentItem = subscription.items.data[0];
        const currentPriceId = currentItem.price.id;
        const expectedPriceId = PRICE_IDS[planId] && PRICE_IDS[planId][interval];
        
        console.log('🔍 Subscription debug - current price ID:', currentPriceId);
        console.log('🔍 Subscription debug - expected price ID:', expectedPriceId);
        
        if (expectedPriceId && currentPriceId !== expectedPriceId) {
          // The subscription item has been changed but billing hasn't started yet
          // User still has access to the original plan
          hasScheduledChange = true;
          console.log('🔍 Subscription debug - scheduled change detected via price mismatch');
          console.log('🔍 Subscription debug - effective plan:', effectivePlan, effectiveInterval);
          
          // Find what the current price represents (this is what they'll be billed for next period)
          for (const [plan, intervals] of Object.entries(PRICE_IDS)) {
            for (const [int, priceId] of Object.entries(intervals)) {
              if (priceId === currentPriceId) {
                // Update the scheduled change info
                scheduledPlanId = plan;
                scheduledInterval = int;
                break;
              }
            }
          }
        } else {
          console.log('🔍 Subscription debug - no scheduled change, using metadata plan');
        }
      }
    }

    // Determine the effective status
    let effectiveStatus = subscription.status;
    if (subscription.cancel_at_period_end) {
      effectiveStatus = 'canceled_at_period_end';
    }

    res.json({
      plan: effectivePlan, // Show current effective plan (what user has access to)
      status: effectiveStatus,
      interval: effectiveInterval,
      currentPeriodEnd: subscription.current_period_end,
      hipaaEnabled: effectivePlan === 'pro' || effectivePlan === 'enterprise',
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      isTrial: isTrial,  // Add trial status
      trialEnd: trialEnd,  // Add trial end date
      trialEndingSoon: isTrialEndingSoon,  // Add trial ending soon flag
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

    // Get subscription (including trialing status)
    // CRITICAL FIX: Query must include 'trialing' status to support trial subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',  // Include all statuses to get 'trialing' subscriptions
      limit: 10  // Get more to filter
    });

    // Find active, trialing, or past_due subscription
    const subscription = subscriptions.data.find(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }
    
    // Check if subscription has an active schedule (created during plan changes in trial)
    // If schedule exists, we must cancel the schedule instead of the subscription directly
    let canceledSubscription;
    let cancellationDate;
    let hasSchedule = false;
    
    try {
      const schedules = await stripe.subscriptionSchedules.list({
        subscription: subscription.id,
        limit: 1
      });
      
      if (schedules.data.length > 0) {
        const schedule = schedules.data[0];
        hasSchedule = true;
        console.log('🔍 Found active subscription schedule:', schedule.id, 'canceling schedule instead of subscription');
        
        // Cancel the schedule - this removes the schedule but subscription continues
        // We also need to explicitly set cancel_at_period_end on the subscription
        await stripe.subscriptionSchedules.cancel(schedule.id);
        console.log('✅ Subscription schedule canceled successfully');
        
        // Explicitly set cancel_at_period_end on subscription to ensure it's canceled at period end
        canceledSubscription = await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: true
        });
        
        // Determine cancellation date: trial_end if in trial, otherwise current_period_end
        cancellationDate = subscription.status === 'trialing' 
          ? subscription.trial_end 
          : subscription.current_period_end;
      } else {
        // No schedule exists - cancel subscription directly
        console.log('🔍 No subscription schedule found, canceling subscription directly');
        canceledSubscription = await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: true
        });
        
        // Determine cancellation date: trial_end if in trial, otherwise current_period_end
        cancellationDate = subscription.status === 'trialing' 
          ? subscription.trial_end 
          : subscription.current_period_end;
      }
    } catch (scheduleError) {
      console.error('🔍 Error checking/canceling subscription schedule:', scheduleError.message);
      // Fallback: try to cancel subscription directly if schedule check fails
      console.log('🔍 Falling back to direct subscription cancellation');
      canceledSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true
      });
      cancellationDate = subscription.status === 'trialing' 
        ? subscription.trial_end 
        : subscription.current_period_end;
    }

    const cancellationMessage = subscription.status === 'trialing'
      ? 'Subscription will be canceled at the end of your trial period'
      : 'Subscription will be canceled at the end of your current billing period';

    res.json({ 
      success: true, 
      message: cancellationMessage,
      subscription: canceledSubscription,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: cancellationDate,  // Backward compatibility
      cancellationDate: cancellationDate,  // New field (more descriptive)
      canceledViaSchedule: hasSchedule
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Resume subscription (cancel the pending cancellation)
router.post('/resume-subscription', authenticateToken, async (req, res) => {
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

    // Get subscription (including trialing status)
    // CRITICAL FIX: Query must include 'trialing' status to support trial subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',  // Include all statuses to get 'trialing' subscriptions
      limit: 10  // Get more to filter
    });

    // Find active, trialing, or past_due subscription
    const subscription = subscriptions.data.find(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Check if subscription is actually pending cancellation
    if (!subscription.cancel_at_period_end) {
      return res.status(400).json({ error: 'Subscription is not pending cancellation' });
    }

    // Resume the subscription by setting cancel_at_period_end to false
    const resumedSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: false
    });

    res.json({ 
      success: true, 
      message: 'Subscription resumed successfully',
      subscription: resumedSubscription,
      cancelAtPeriodEnd: false
    });
  } catch (error) {
    console.error('Resume subscription error:', error);
    res.status(500).json({ error: 'Failed to resume subscription' });
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

    // Get subscription (including trialing status)
    // CRITICAL FIX: Query must include 'trialing' status to support trial subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',  // Include all statuses to get 'trialing' subscriptions
      limit: 10  // Get more to filter
    });

    // Find active, trialing, or past_due subscription
    const subscription = subscriptions.data.find(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const currentPlanId = subscription.metadata.planId;
    const scheduledPlanId = subscription.metadata.scheduledPlanId;
    const newPriceId = PRICE_IDS[newPlanId][interval];
    
    // Check if subscription is in trial
    const isInTrial = subscription.status === 'trialing';
    const trialEnd = subscription.trial_end;
    
    console.log('🔍 Change plan debug - current plan:', currentPlanId);
    console.log('🔍 Change plan debug - scheduled plan:', scheduledPlanId);
    console.log('🔍 Change plan debug - new plan:', newPlanId);
    console.log('🔍 Change plan debug - is in trial:', isInTrial);
    
    // Determine effective plan for upgrade calculations
    const effectivePlanId = scheduledPlanId || currentPlanId;
    
    // Determine if this is a downgrade
    const currentPlanIndex = ['basic', 'pro', 'enterprise'].indexOf(effectivePlanId);
    const newPlanIndex = ['basic', 'pro', 'enterprise'].indexOf(newPlanId);
    const isDowngrade = newPlanIndex < currentPlanIndex;
    
    console.log('🔍 Change plan debug - effective plan:', effectivePlanId);
    console.log('🔍 Change plan debug - is downgrade:', isDowngrade);
    
    // DOWNGRADES DURING TRIAL ARE ALLOWED
    // User can downgrade to free or any lesser plan during trial
    // The downgrade will take effect at trial end (30 days)
    // User keeps current plan benefits until trial end
    
    // If in trial (upgrade OR downgrade), use subscription schedule with trial_end
    if (isInTrial) {
      // Create subscription schedule for trial end
      // This works for both upgrades and downgrades during trial
      // NOTE: Cannot set phases when using from_subscription - must create then update
      try {
        // Step 1: Create schedule from subscription (without phases or metadata)
        // NOTE: Stripe doesn't allow setting metadata or phases when from_subscription is set
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscription.id
        });
        
        // Step 2: Update schedule with phases and metadata
        await stripe.subscriptionSchedules.update(schedule.id, {
          metadata: {
            userId: userId,
            planId: subscription.metadata.planId,
            interval: subscription.metadata.interval,
            scheduledPlanId: newPlanId,
            scheduledInterval: interval,
          },
          phases: [
            {
              items: [{
                price: subscription.items.data[0].price.id, // Keep current price during trial
                quantity: 1,
              }],
              start_date: subscription.current_period_start, // Start from current period start
              end_date: trialEnd,  // ← Use trial_end, not current_period_end
            },
            {
              items: [{
                price: newPriceId, // New price starts after trial ends
                quantity: 1,
              }],
              start_date: trialEnd, // Start after trial ends
            }
          ]
        });
        
        // Step 3: Also update subscription metadata so scheduled change is detected
        await stripe.subscriptions.update(subscription.id, {
          metadata: {
            ...subscription.metadata,
            scheduledPlanId: newPlanId,
            scheduledInterval: interval,
            scheduledChangeDate: trialEnd
          }
        });
        
        const actionType = isDowngrade ? 'downgrade' : 'upgrade';
        res.json({ 
          success: true, 
          message: `Plan ${actionType} scheduled for end of trial period`,
          scheduleId: schedule.id,
          newPlan: newPlanId,
          interval: interval,
          effectiveDate: trialEnd
        });
        return;
      } catch (scheduleError) {
        console.error('Subscription schedule error during trial:', scheduleError);
        return res.status(500).json({ error: 'Failed to schedule plan change for trial' });
      }
    }
    
    // For non-trial subscriptions, use existing logic
    if (isDowngrade) {
      // For downgrades, use Stripe's subscription schedules for true end-of-period changes
      // NOTE: Cannot set phases when using from_subscription - must create then update
      try {
        // Step 1: Create schedule from subscription (without phases or metadata)
        // NOTE: Stripe doesn't allow setting metadata or phases when from_subscription is set
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscription.id
        });
        
        // Step 2: Update schedule with phases and metadata
        await stripe.subscriptionSchedules.update(schedule.id, {
          metadata: {
            userId: userId,
            planId: subscription.metadata.planId,
            interval: subscription.metadata.interval,
            scheduledPlanId: newPlanId,
            scheduledInterval: interval,
          },
          phases: [
            {
              items: [{
                price: subscription.items.data[0].price.id, // Keep current price
                quantity: 1,
              }],
              start_date: subscription.current_period_start, // Start from current period start
              end_date: subscription.current_period_end,
            },
            {
              items: [{
                price: newPriceId, // New price starts after current period
                quantity: 1,
              }],
              start_date: subscription.current_period_end, // Start after current period
            }
          ]
        });

        res.json({ 
          success: true, 
          message: 'Plan change scheduled for end of current period',
          scheduleId: schedule.id,
          newPlan: newPlanId,
          interval: interval,
          effectiveDate: subscription.current_period_end
        });
      } catch (scheduleError) {
        console.error('Subscription schedule error:', scheduleError);
        // Fallback to metadata-only approach if schedules fail
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
          metadata: {
            userId: userId,
            planId: subscription.metadata.planId,
            interval: subscription.metadata.interval,
            scheduledPlanId: newPlanId,
            scheduledInterval: interval,
            scheduledChangeDate: subscription.current_period_end
          }
        });
        
        res.json({ 
          success: true, 
          message: 'Plan change scheduled for end of current period (metadata only)',
          subscription: updatedSubscription,
          newPlan: newPlanId,
          interval: interval,
          effectiveDate: subscription.current_period_end
        });
      }
    } else {
      // Upgrade - immediate change with immediate proration charge
      
      // First, check if there's an active subscription schedule and cancel it
      // This ensures proration is calculated from the actual current plan, not scheduled plan
      console.log('🔍 Checking for subscription schedules for subscription:', subscription.id);
      try {
        const schedules = await stripe.subscriptionSchedules.list({
          subscription: subscription.id,
          limit: 1
        });
        
        console.log('🔍 Found', schedules.data.length, 'subscription schedules');
        
        if (schedules.data.length > 0) {
          const schedule = schedules.data[0];
          console.log('🔍 Found active subscription schedule:', schedule.id, 'canceling it before upgrade');
          await stripe.subscriptionSchedules.cancel(schedule.id);
          console.log('🔍 Subscription schedule canceled successfully');
        } else {
          console.log('🔍 No subscription schedules found');
        }
      } catch (scheduleError) {
        console.log('🔍 Error checking/canceling subscription schedule:', scheduleError.message);
      }

      const updateParams = {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'always_invoice', // Charge proration immediately, not on next invoice
        metadata: {
          userId: userId,
          planId: newPlanId,
          interval: interval,
          scheduledPlanId: null, // Clear any scheduled changes
          scheduledInterval: null,
          scheduledChangeDate: null
        }
      };

      // If subscription is pending cancellation, cancel the cancellation
      if (subscription.cancel_at_period_end) {
        updateParams.cancel_at_period_end = false;
        console.log('🔍 Upgrade from pending cancellation - canceling the cancellation');
      }

      const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);

      res.json({ 
        success: true, 
        message: subscription.cancel_at_period_end ? 
          'Plan upgraded successfully and cancellation canceled' : 
          'Plan upgraded successfully',
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

    // Get subscription (including trialing status)
    // CRITICAL FIX: Query must include 'trialing' status to support trial subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',  // Include all statuses to get 'trialing' subscriptions
      limit: 10  // Get more to filter
    });

    // Find active, trialing, or past_due subscription
    const subscription = subscriptions.data.find(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const subscriptionPlanId = subscription.metadata.planId;
    const scheduledPlanId = subscription.metadata.scheduledPlanId;
    
    // Check if subscription is in trial
    const isInTrial = subscription.status === 'trialing';
    
    if (isInTrial) {
      return res.status(400).json({ 
        error: 'Interval changes are not available during trial period. You can change your billing interval after your trial ends.' 
      });
    }
    
    // For interval changes, always use the current plan (not scheduled plan)
    // The scheduled plan only affects future billing, not current upgrades
    const effectivePlanId = subscriptionPlanId;
    const newPriceId = PRICE_IDS[effectivePlanId][newInterval];
    
  // Determine current interval from subscription
  const currentInterval = subscription.metadata?.interval || subscription.items.data[0]?.price?.recurring?.interval || 'monthly'

  console.log('🔍 Change interval debug - subscription plan:', subscriptionPlanId)
  console.log('🔍 Change interval debug - scheduled plan:', scheduledPlanId)
  console.log('🔍 Change interval debug - effective plan:', effectivePlanId)
  console.log('🔍 Change interval debug - current interval:', currentInterval)
  console.log('🔍 Change interval debug - new interval:', newInterval)

  // Monthly -> Annual (upgrade): charge immediately, start a new annual period today
  if (currentInterval === 'monthly' && newInterval === 'annual') {
    // First, check if there's an active subscription schedule and cancel it
    // This ensures proration is calculated from the actual current plan, not scheduled plan
    console.log('🔍 Checking for subscription schedules for subscription:', subscription.id);
    try {
      const schedules = await stripe.subscriptionSchedules.list({
        subscription: subscription.id,
        limit: 1
      });
      
      console.log('🔍 Found', schedules.data.length, 'subscription schedules');
      
      if (schedules.data.length > 0) {
        const schedule = schedules.data[0];
        console.log('🔍 Found active subscription schedule:', schedule.id, 'canceling it before interval upgrade');
        await stripe.subscriptionSchedules.cancel(schedule.id);
        console.log('🔍 Subscription schedule canceled successfully');
      } else {
        console.log('🔍 No subscription schedules found');
      }
    } catch (scheduleError) {
      console.log('🔍 Error checking/canceling subscription schedule:', scheduleError.message);
    }

    const updateParams = {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'always_invoice', // charge/prorate immediately
      billing_cycle_anchor: 'now',          // reset period to start today
      metadata: {
        userId: userId,
        planId: effectivePlanId,
        interval: 'annual',
        scheduledPlanId: null, // Clear any scheduled changes
        scheduledInterval: null,
        scheduledChangeDate: null
      }
    };

    // If subscription is pending cancellation, cancel the cancellation
    if (subscription.cancel_at_period_end) {
      updateParams.cancel_at_period_end = false;
      console.log('🔍 Monthly->Annual upgrade from pending cancellation - canceling the cancellation');
    }

    const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);

    return res.json({
      success: true,
      message: subscription.cancel_at_period_end ? 
        'Billing interval upgraded to annual immediately and cancellation canceled' :
        'Billing interval upgraded to annual immediately',
      subscription: updatedSubscription,
      newInterval: newInterval
    })
  }

  // Annual -> Monthly (downgrade): defer to end of current period, no proration
  if (currentInterval === 'annual' && newInterval === 'monthly') {
    const updateParams = {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'none', // take effect next period
      metadata: {
        userId: userId,
        planId: effectivePlanId,
        interval: currentInterval,
        scheduledInterval: 'monthly',
        scheduledChangeDate: subscription.current_period_end
      }
    };

    // If subscription is pending cancellation, cancel the cancellation
    if (subscription.cancel_at_period_end) {
      updateParams.cancel_at_period_end = false;
      console.log('🔍 Annual->Monthly downgrade from pending cancellation - canceling the cancellation');
    }

    const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);

    return res.json({
      success: true,
      message: subscription.cancel_at_period_end ? 
        'Billing interval change to monthly scheduled for end of period and cancellation canceled' :
        'Billing interval change to monthly scheduled for end of period',
      subscription: updatedSubscription,
      newInterval: newInterval,
      effectiveDate: subscription.current_period_end
    })
  }

  // No-op or unsupported transition
  return res.status(400).json({ error: `No interval change performed from ${currentInterval} to ${newInterval}` })
  } catch (error) {
    console.error('Change interval error:', error);
    res.status(500).json({ error: 'Failed to change billing interval' });
  }
});

module.exports = router;
