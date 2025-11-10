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
      // CRITICAL: Must check both status AND trial_end because schedules can make status 'active' 
      // even when trial_end is still in the future
      // CRITICAL: Also check if current_period_end > trial_end to detect ended trials
      const now = Date.now() / 1000;
      const hasTrialingSubscription = existingSubscriptions.data.some(sub => {
        const trialEnd = sub.trial_end;
        const hasTrialEnded = trialEnd !== null && 
                              sub.current_period_end > trialEnd;
        const isInTrial = !hasTrialEnded && (
          sub.status === 'trialing' || 
          (trialEnd !== null && trialEnd > now)
        );
        return isInTrial;
      });

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
    // CRITICAL: Must check both status AND trial_end because schedules can make status 'active' 
    // even when trial_end is still in the future (Stripe shows "Trial ends Dec xxx" in this case)
    // CRITICAL: Also check if current_period_end > trial_end to detect ended trials
    // (Stripe may keep trial_end set even after trial ends, and server time may not match Stripe's simulated time)
    const now = Date.now() / 1000;
    const trialEnd = subscription.trial_end; // Unix timestamp
    const hasTrialEnded = trialEnd !== null && 
                          subscription.current_period_end > trialEnd; // Trial ended if billing period started after trial_end
    const isTrial = !hasTrialEnded && (
      subscription.status === 'trialing' || 
      (trialEnd !== null && trialEnd > now)
    );
    const isTrialEndingSoon = trialEnd && !hasTrialEnded && (trialEnd - now) < 3 * 24 * 60 * 60; // 3 days
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    let scheduledPlanId = subscription.metadata.scheduledPlanId;
    let scheduledInterval = subscription.metadata.scheduledInterval;
    
    console.log('🔍 Subscription debug - metadata planId:', planId);
    console.log('🔍 Subscription debug - metadata interval:', interval);
    console.log('🔍 Subscription debug - scheduledPlanId:', scheduledPlanId);
    console.log('🔍 Subscription debug - scheduledInterval:', scheduledInterval);
    console.log('🔍 Subscription debug - current period end:', subscription.current_period_end);
    
    // Check if there's a scheduled change
    let effectivePlan = planId;
    let effectiveInterval = interval;
    let hasScheduledChange = false;
    let isIntervalOnlyChange = false;
    
    // Check for scheduled interval change (plan stays same, interval changes)
    // CRITICAL: Check metadata FIRST - it's the source of truth for scheduled changes
    if (scheduledInterval && scheduledInterval !== interval && (!scheduledPlanId || scheduledPlanId === planId)) {
      hasScheduledChange = true;
      isIntervalOnlyChange = true;
      effectiveInterval = scheduledInterval;
      scheduledPlanId = planId; // Ensure scheduledPlanId is set to current plan for interval-only changes
      console.log('🔍 Subscription debug - scheduled interval change detected via metadata:', interval, '→', scheduledInterval);
    } else if (scheduledPlanId && scheduledPlanId !== planId) {
      // There's a scheduled plan change (with or without interval change)
      hasScheduledChange = true;
      console.log('🔍 Subscription debug - scheduled plan change detected via metadata');
      
      // Determine if this is an upgrade or downgrade
      const planHierarchy = ['basic', 'pro', 'enterprise'];
      const isUpgrade = planHierarchy.indexOf(scheduledPlanId) > planHierarchy.indexOf(planId);
      const isDowngrade = planHierarchy.indexOf(scheduledPlanId) < planHierarchy.indexOf(planId);
      
      // For upgrades (trial or active), show scheduled plan as effective plan
      // This gives users immediate feedback that their upgrade is registered
      // For downgrades, user keeps current plan until period ends
      if (isUpgrade) {
        // Upgrade: Show scheduled plan as effective (user sees what they're upgrading to)
        effectivePlan = scheduledPlanId;
        effectiveInterval = scheduledInterval || interval;
        console.log('🔍 Subscription debug - upgrade detected, showing scheduled plan as effective:', effectivePlan, effectiveInterval);
      } else if (isDowngrade) {
        // Downgrade: User keeps current plan until period ends
        console.log('🔍 Subscription debug - downgrade detected, keeping current plan until period ends:', effectivePlan, effectiveInterval);
    } else {
        // Same plan (shouldn't happen, but handle gracefully)
        console.log('🔍 Subscription debug - scheduled change to same plan, keeping current plan:', effectivePlan, effectiveInterval);
      }
    } else if (!hasScheduledChange) {
      // Only check price mismatch if we haven't already detected a scheduled change via metadata
      // This prevents overwriting metadata-based scheduled changes with price-based detection
      // Price mismatch check is a fallback for cases where metadata wasn't set correctly
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
          console.log('🔍 Subscription debug - scheduled change detected via price mismatch (fallback)');
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
        newPlan: scheduledPlanId || planId, // Use current plan if only interval changes
        newInterval: scheduledInterval || interval,
        effectiveDate: subscription.current_period_end,
        isIntervalOnly: isIntervalOnlyChange // Flag to indicate interval-only change
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
    
    // First, check if subscription object has a schedule property (direct reference)
    // If subscription is managed by a schedule, Stripe includes schedule ID on the subscription
    let scheduleId = subscription.schedule;
    
    // If no direct reference, try to find schedule by listing schedules for the customer
    if (!scheduleId) {
      try {
        const schedules = await stripe.subscriptionSchedules.list({
          customer: subscription.customer,
          limit: 10
        });
        
        // Find schedule that matches this subscription
        const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
        if (matchingSchedule) {
          scheduleId = matchingSchedule.id;
        }
      } catch (listError) {
        console.log('🔍 Could not list schedules, will try direct cancellation:', listError.message);
      }
    }
    
    if (scheduleId) {
      hasSchedule = true;
      console.log('🔍 Found subscription schedule:', scheduleId);
      
      // Check if subscription is in trial - if so, release schedule first, then cancel subscription directly
      // This ensures cancel_at_period_end is set correctly during trial
      const now = Date.now() / 1000;
      const trialEndForCancel = subscription.trial_end;
      const hasTrialEndedForCancel = trialEndForCancel !== null && 
                                     subscription.current_period_end > trialEndForCancel;
      const isInTrialForCancel = !hasTrialEndedForCancel && (
        subscription.status === 'trialing' || 
        (trialEndForCancel !== null && trialEndForCancel > now)
      );
      
      if (isInTrialForCancel && trialEndForCancel && !hasTrialEndedForCancel) {
        // For trial subscriptions, release schedule first, then cancel subscription directly
        // This ensures we can set cancel_at_period_end and preserve trial_end
        console.log('🔍 Trial subscription with schedule - releasing schedule, then canceling subscription directly');
        try {
          await stripe.subscriptionSchedules.release(scheduleId);
          console.log('✅ Schedule released, now canceling subscription directly');
          
          // Cancel subscription directly with cancel_at_period_end and trial_end preservation
          const cancelParams = {
            cancel_at_period_end: true,
            trial_end: trialEndForCancel // ✅ PRESERVE trial_end
          };
          
          canceledSubscription = await stripe.subscriptions.update(subscription.id, cancelParams);
          cancellationDate = trialEndForCancel; // Cancel at trial end
          
          console.log('✅ Subscription canceled at trial end with trial preserved');
        } catch (releaseError) {
          console.error('🔍 Error releasing schedule for trial cancellation:', releaseError.message);
          // Fall back to canceling schedule
          await stripe.subscriptionSchedules.cancel(scheduleId);
          canceledSubscription = await stripe.subscriptions.retrieve(subscription.id);
          cancellationDate = trialEndForCancel;
        }
      } else {
        // Not in trial - cancel the schedule (Stripe will set cancel_at_period_end automatically)
        console.log('🔍 Canceling schedule (non-trial)');
        try {
          await stripe.subscriptionSchedules.cancel(scheduleId);
          console.log('✅ Subscription schedule canceled successfully');
        
        // CRITICAL: Preserve trial_end if subscription is in trial (and trial hasn't ended)
        // When canceling a schedule during trial, we must explicitly preserve trial_end
        // to keep subscription in trialing status
        const now = Date.now() / 1000;
        const trialEnd = subscription.trial_end;
        const hasTrialEnded = trialEnd !== null && 
                              subscription.current_period_end > trialEnd;
        const isInTrial = !hasTrialEnded && (
          subscription.status === 'trialing' || 
          (trialEnd !== null && trialEnd > now)
        );
        
        // Retrieve subscription after schedule cancellation to check current state
        canceledSubscription = await stripe.subscriptions.retrieve(subscription.id);
        
        // CRITICAL: Only update subscription if it's not already canceled
        // If subscription is canceled, we can only update cancellation_details, not other fields
        const isCanceled = canceledSubscription.status === 'canceled';
        
        if (!isCanceled) {
          // Check if we need to set cancel_at_period_end or preserve trial_end
          if (isInTrial && trialEnd && !hasTrialEnded) {
            // For trial subscriptions, we need to explicitly set cancel_at_period_end
            // and preserve trial_end (Stripe may not do this automatically during trial)
            if (!canceledSubscription.cancel_at_period_end || canceledSubscription.trial_end !== trialEnd) {
              console.log('🔍 Preserving trial_end and setting cancel_at_period_end after schedule cancellation during trial');
              try {
                canceledSubscription = await stripe.subscriptions.update(subscription.id, {
                  trial_end: trialEnd, // ✅ EXPLICITLY PRESERVE trial_end (only if trial hasn't ended)
                  cancel_at_period_end: true // ✅ EXPLICITLY SET cancel_at_period_end (Stripe may not set it automatically during trial)
                });
              } catch (updateError) {
                // If update fails (e.g., subscription canceled between retrieve and update), log but continue
                console.warn('⚠️  Could not update subscription after schedule cancellation:', updateError.message);
                // Re-retrieve to get current state
                canceledSubscription = await stripe.subscriptions.retrieve(subscription.id);
              }
            }
          } else {
            // Not in trial - ensure cancel_at_period_end is set
            // Stripe should set this automatically when schedule is canceled, but let's verify
            if (!canceledSubscription.cancel_at_period_end) {
              console.log('🔍 Setting cancel_at_period_end after schedule cancellation (non-trial)');
              try {
                canceledSubscription = await stripe.subscriptions.update(subscription.id, {
                  cancel_at_period_end: true
                });
              } catch (updateError) {
                // If update fails, log but continue - Stripe should have set it
                console.warn('⚠️  Could not set cancel_at_period_end after schedule cancellation:', updateError.message);
                // Re-retrieve to get current state
                canceledSubscription = await stripe.subscriptions.retrieve(subscription.id);
              }
            }
          }
        } else {
          // Subscription is already canceled - can't update it
          console.log('⚠️  Subscription already canceled after schedule cancellation - cannot update');
          // For canceled subscriptions, cancel_at_period_end is not relevant
          // The subscription will be deleted at the end of the period (trial_end for trials)
        }
        
        // Retrieve final subscription state
        canceledSubscription = await stripe.subscriptions.retrieve(subscription.id);
        
        // Determine cancellation date: trial_end if in trial, otherwise current_period_end
        cancellationDate = isInTrial && trialEnd
          ? trialEnd 
          : subscription.current_period_end;
      } catch (scheduleCancelError) {
        console.error('🔍 Error canceling subscription schedule:', scheduleCancelError.message);
        // If schedule cancellation fails, try to release subscription from schedule
        try {
          await stripe.subscriptionSchedules.release(scheduleId);
          console.log('✅ Released subscription from schedule, now canceling directly');
          
          // CRITICAL: Preserve trial_end if subscription is in trial (and trial hasn't ended)
          const now = Date.now() / 1000;
          const trialEnd = subscription.trial_end;
          const hasTrialEnded = trialEnd !== null && 
                                subscription.current_period_end > trialEnd;
          const isInTrial = !hasTrialEnded && (
            subscription.status === 'trialing' || 
            (trialEnd !== null && trialEnd > now)
          );
          
          const cancelParams = {
            cancel_at_period_end: true
          };
          
          if (isInTrial && trialEnd && !hasTrialEnded) {
            cancelParams.trial_end = trialEnd; // ✅ PRESERVE trial_end (only if trial hasn't ended)
            console.log('🔍 Preserving trial_end during cancellation after schedule release');
          }
          
          canceledSubscription = await stripe.subscriptions.update(subscription.id, cancelParams);
          cancellationDate = isInTrial && trialEnd
            ? trialEnd 
            : subscription.current_period_end;
        } catch (releaseError) {
          console.error('🔍 Error releasing schedule:', releaseError.message);
          // Last resort: try direct cancellation (may fail, but worth trying)
          console.log('🔍 Attempting direct cancellation as last resort');
          
          // CRITICAL: Preserve trial_end if subscription is in trial (and trial hasn't ended)
          const now = Date.now() / 1000;
          const trialEnd = subscription.trial_end;
          const hasTrialEnded = trialEnd !== null && 
                                subscription.current_period_end > trialEnd;
          const isInTrial = !hasTrialEnded && (
            subscription.status === 'trialing' || 
            (trialEnd !== null && trialEnd > now)
          );
          
          const cancelParams = {
            cancel_at_period_end: true
          };
          
          if (isInTrial && trialEnd && !hasTrialEnded) {
            cancelParams.trial_end = trialEnd; // ✅ PRESERVE trial_end (only if trial hasn't ended)
            console.log('🔍 Preserving trial_end during direct cancellation');
          }
          
          canceledSubscription = await stripe.subscriptions.update(subscription.id, cancelParams);
          cancellationDate = isInTrial && trialEnd
            ? trialEnd 
            : subscription.current_period_end;
        }
      }
    } else {
      // No schedule exists - cancel subscription directly
      console.log('🔍 No subscription schedule found, canceling subscription directly');
      
      // CRITICAL: Preserve trial_end if subscription is in trial (and trial hasn't ended)
      const now = Date.now() / 1000;
      const trialEnd = subscription.trial_end;
      const hasTrialEnded = trialEnd !== null && 
                            subscription.current_period_end > trialEnd;
      const isInTrial = !hasTrialEnded && (
        subscription.status === 'trialing' || 
        (trialEnd !== null && trialEnd > now)
      );
      
      const cancelParams = {
        cancel_at_period_end: true
      };
      
      if (isInTrial && trialEnd && !hasTrialEnded) {
        cancelParams.trial_end = trialEnd; // ✅ PRESERVE trial_end (only if trial hasn't ended)
        console.log('🔍 Preserving trial_end during direct cancellation (no schedule)');
      }
      
      canceledSubscription = await stripe.subscriptions.update(subscription.id, cancelParams);
      
      // Determine cancellation date: trial_end if in trial, otherwise current_period_end
      cancellationDate = isInTrial && trialEnd
        ? trialEnd 
        : subscription.current_period_end;
    }

    // Use isInTrial (already calculated) instead of status check for accurate message
    // This handles subscriptions with schedules that might have status 'active' but trial_end in future
    // CRITICAL: Also check if current_period_end > trial_end to detect ended trials
    const now = Date.now() / 1000;
    const trialEndForMessage = subscription.trial_end;
    const hasTrialEndedForMessage = trialEndForMessage !== null && 
                                     subscription.current_period_end > trialEndForMessage;
    const isInTrialForMessage = !hasTrialEndedForMessage && (
      subscription.status === 'trialing' || 
      (trialEndForMessage !== null && trialEndForMessage > now)
    );
    const cancellationMessage = isInTrialForMessage
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
    // CRITICAL: Must check both status AND trial_end because schedules can make status 'active' 
    // even when trial_end is still in the future (Stripe shows "Trial ends Dec xxx" in this case)
    const now = Date.now() / 1000;
    const trialEnd = subscription.trial_end;
    // Check if trial has ended: if current_period_end > trial_end, trial has ended
    // This handles cases where Stripe's test clock time doesn't match server time
    const hasTrialEnded = trialEnd !== null && 
                          subscription.current_period_end > trialEnd;
    const isInTrial = !hasTrialEnded && (
      subscription.status === 'trialing' || 
      (trialEnd !== null && trialEnd > now)
    );
    
    console.log('🔍 Change plan debug - current plan:', currentPlanId);
    console.log('🔍 Change plan debug - scheduled plan:', scheduledPlanId);
    console.log('🔍 Change plan debug - new plan:', newPlanId);
    console.log('🔍 Change plan debug - is in trial:', isInTrial);
    console.log('🔍 Change plan debug - has trial ended:', hasTrialEnded);
    
    // Determine effective plan for upgrade calculations
    const effectivePlanId = scheduledPlanId || currentPlanId;
    
    // Determine if this is a downgrade
    const currentPlanIndex = ['basic', 'pro', 'enterprise'].indexOf(effectivePlanId);
    const newPlanIndex = ['basic', 'pro', 'enterprise'].indexOf(newPlanId);
    const isDowngrade = newPlanIndex < currentPlanIndex;
    
    console.log('🔍 Change plan debug - effective plan:', effectivePlanId);
    console.log('🔍 Change plan debug - is downgrade:', isDowngrade);
    
    // TRIAL CHANGES: Use direct updates (no schedules) to avoid proration previews
    // At trial end, user is charged full amount of whatever plan/interval is set
    if (isInTrial) {
      if (isDowngrade) {
        // Downgrade during trial: Direct update (no schedule)
        // User gets new plan features immediately, but no charge until trial ends
        console.log('🔍 Trial downgrade - applying directly, no schedule to avoid proration preview');
        
        // First, release any existing schedule (from previous changes)
        let scheduleId = subscription.schedule;
        if (!scheduleId) {
          try {
            const schedules = await stripe.subscriptionSchedules.list({
              customer: subscription.customer,
              limit: 10
            });
            const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
            if (matchingSchedule) {
              scheduleId = matchingSchedule.id;
            }
          } catch (listError) {
            console.log('🔍 Could not list schedules:', listError.message);
          }
        }
        
        if (scheduleId) {
          console.log('🔍 Found schedule during trial downgrade, releasing it');
          await stripe.subscriptionSchedules.release(scheduleId);
          subscription = await stripe.subscriptions.retrieve(subscription.id);
        }
        
        // Direct update: Change to new plan immediately, preserve trial_end only if trial hasn't ended
        const updateParams = {
              items: [{
            id: subscription.items.data[0].id,
            price: newPriceId, // New plan price
          }],
          proration_behavior: 'none', // ✅ No proration during trial
          metadata: {
            userId: userId,
            planId: newPlanId, // Update to new plan immediately
            interval: interval,
            scheduledPlanId: null, // Clear scheduled changes
            scheduledInterval: null,
            scheduledChangeDate: null
          }
        };
        
        // Only preserve trial_end if trial hasn't ended (Stripe rejects past trial_end values)
        if (trialEnd && !hasTrialEnded) {
          updateParams.trial_end = trialEnd; // ✅ PRESERVE trial_end only if trial is still active
        }
        
        // If subscription is pending cancellation, cancel the cancellation
        if (subscription.cancel_at_period_end) {
          updateParams.cancel_at_period_end = false;
          console.log('🔍 Trial downgrade from pending cancellation - canceling the cancellation');
        }
        
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);
        
        res.json({ 
          success: true, 
          message: 'Plan downgraded successfully. New plan features are now active.',
          subscription: updatedSubscription,
          newPlan: newPlanId,
          interval: interval
        });
        return;
      } else {
        // Upgrade during trial: Immediate upgrade with Pro features unlocked instantly
        // Update subscription items to Pro price immediately, keep trial_end unchanged
        console.log('🔍 Trial upgrade - applying immediately, keeping trial_end unchanged');
        
        // First, check if there's an active subscription schedule and release it
        let scheduleId = subscription.schedule;
        if (!scheduleId) {
          try {
            const schedules = await stripe.subscriptionSchedules.list({
              customer: subscription.customer,
              limit: 10
            });
            const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
            if (matchingSchedule) {
              scheduleId = matchingSchedule.id;
            }
          } catch (listError) {
            console.log('🔍 Could not list schedules:', listError.message);
          }
        }
        
        if (scheduleId) {
          console.log('🔍 Found schedule during trial upgrade, releasing it');
          await stripe.subscriptionSchedules.release(scheduleId);
          subscription = await stripe.subscriptions.retrieve(subscription.id);
          // After releasing schedule, trial_end might be lost - preserve it
          if (subscription.trial_end !== trialEnd && trialEnd && !hasTrialEnded) {
            console.log('🔍 Trial_end changed after schedule release, preserving original trial_end');
          }
        }
        
        // Immediate upgrade: Update items to Pro price, preserve trial_end only if trial hasn't ended
        const updateParams = {
          items: [{
            id: subscription.items.data[0].id,
            price: newPriceId, // Pro price
          }],
          proration_behavior: 'none', // No proration during trial - nothing has been paid yet
          metadata: {
            userId: userId,
            planId: newPlanId, // Update to Pro immediately
            interval: interval,
            scheduledPlanId: null, // Clear any scheduled changes
            scheduledInterval: null,
            scheduledChangeDate: null
          }
        };
        
        // CRITICAL: Always preserve trial_end if trial hasn't ended (especially after schedule release)
        if (trialEnd && !hasTrialEnded) {
          updateParams.trial_end = trialEnd; // ✅ PRESERVE trial_end only if trial is still active
        }
        
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);
        
        res.json({ 
          success: true, 
          message: 'Plan upgraded to Pro immediately. Pro features are now active.',
          subscription: updatedSubscription,
          newPlan: newPlanId,
          interval: interval
        });
        return;
      }
    }
    
    // For non-trial subscriptions, use existing logic
    if (isDowngrade) {
      // For downgrades, use Stripe's subscription schedules for true end-of-period changes
      // ✅ CRITICAL FIX: Check for existing schedule before creating new one
      try {
        // Check if subscription already has a schedule
        let scheduleId = subscription.schedule;
        let existingSchedule = null;
        
        if (!scheduleId) {
          try {
            const schedules = await stripe.subscriptionSchedules.list({
              customer: subscription.customer,
              limit: 10
            });
            const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
            if (matchingSchedule) {
              scheduleId = matchingSchedule.id;
              existingSchedule = matchingSchedule;
            }
          } catch (listError) {
            console.log('🔍 Could not list schedules:', listError.message);
          }
        } else {
          // If schedule ID exists, retrieve the schedule
          try {
            existingSchedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
          } catch (retrieveError) {
            console.log('🔍 Could not retrieve schedule:', retrieveError.message);
          }
        }
        
        if (existingSchedule && scheduleId) {
          // ✅ Update existing schedule instead of creating new one
          console.log('🔍 Found existing schedule:', scheduleId, 'updating it for plan downgrade');
          await stripe.subscriptionSchedules.update(scheduleId, {
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
            scheduleId: scheduleId,
            newPlan: newPlanId,
            interval: interval,
            effectiveDate: subscription.current_period_end
          });
        } else {
          // No existing schedule - create new one
          // NOTE: Cannot set phases when using from_subscription - must create then update
          console.log('🔍 No existing schedule found, creating new one for plan downgrade');
          
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
        }
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
        // Check subscription.schedule property first
        let scheduleId = subscription.schedule;
        
        // If not found, list schedules by customer
        if (!scheduleId) {
        const schedules = await stripe.subscriptionSchedules.list({
            customer: subscription.customer,
            limit: 10
          });
          
          const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
          if (matchingSchedule) {
            scheduleId = matchingSchedule.id;
          }
        }
        
        if (scheduleId) {
          // Use release() instead of cancel() to avoid setting cancel_at_period_end on subscription
          // We're immediately upgrading, so we just need to detach the schedule
          console.log('🔍 Found active subscription schedule:', scheduleId, 'releasing it before upgrade');
          await stripe.subscriptionSchedules.release(scheduleId);
          console.log('🔍 Subscription schedule released successfully');
          
          // Retrieve subscription after schedule release to get current state
          subscription = await stripe.subscriptions.retrieve(subscription.id);
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

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    // Get subscription (including trialing status) FIRST
    // CRITICAL FIX: Query must include 'trialing' status to support trial subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',  // Include all statuses to get 'trialing' subscriptions
      limit: 10  // Get more to filter
    });

    // Find active, trialing, or past_due subscription
    // Use let instead of const because we may need to reassign after releasing schedules
    let subscription = subscriptions.data.find(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const subscriptionPlanId = subscription.metadata.planId;
    const scheduledPlanId = subscription.metadata.scheduledPlanId;
    
    // Enhanced logging for debugging
    console.log('🔍 Change interval debug - subscription status:', subscription.status);
    console.log('🔍 Change interval debug - subscription id:', subscription.id);
    console.log('🔍 Change interval debug - has trial_end:', !!subscription.trial_end);
    console.log('🔍 Change interval debug - trial_end value:', subscription.trial_end);
    console.log('🔍 Change interval debug - current_period_end:', subscription.current_period_end);
    console.log('🔍 Change interval debug - subscription schedule:', subscription.schedule);
    
    // Validate that the plan supports the new interval using subscription metadata (not Firestore)
    // This ensures we use the actual subscription plan, not potentially out-of-sync Firestore data
    if (!subscriptionPlanId) {
      return res.status(400).json({ error: 'Subscription plan not found in metadata' });
    }
    
    if (!PRICE_IDS[subscriptionPlanId] || !PRICE_IDS[subscriptionPlanId][newInterval]) {
      return res.status(400).json({ error: `Plan ${subscriptionPlanId} does not support ${newInterval} billing` });
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
    
    // Check if subscription is in trial
    // CRITICAL: Must check both status AND trial_end because schedules can make status 'active' 
    // even when trial_end is still in the future (Stripe shows "Trial ends Dec xxx" in this case)
    // CRITICAL: Also check if current_period_end > trial_end to detect ended trials
    // (Stripe may keep trial_end set even after trial ends, and server time may not match Stripe's simulated time)
    const now = Date.now() / 1000;
    const trialEnd = subscription.trial_end;
    // Check if trial has ended: if current_period_end > trial_end, trial has ended
    // This handles cases where Stripe's test clock time doesn't match server time
    const hasTrialEnded = trialEnd !== null && 
                          subscription.current_period_end > trialEnd;
    const isInTrial = !hasTrialEnded && (
      subscription.status === 'trialing' || 
      (trialEnd !== null && trialEnd > now)
    );
    
    console.log('🔍 Change interval debug - isInTrial:', isInTrial)
    console.log('🔍 Change interval debug - trialEnd:', trialEnd)
    console.log('🔍 Change interval debug - has trial ended:', hasTrialEnded)
    
    // Determine if this is an upgrade or downgrade
    // ✅ VALUE-BASED LOGIC: Interval changes are based on value proposition, NOT plan tier
    // - Monthly → Annual = upgrade (always immediate) - Annual has more value regardless of plan tier
    //   Examples: Monthly Pro → Annual Pro (immediate), Monthly Pro → Annual Basic (immediate)
    // - Annual → Monthly = downgrade (always end of period) - Monthly has less value regardless of plan tier
    //   Examples: Annual Pro → Monthly Pro (end of period), Annual Basic → Monthly Pro (end of period)
    // This ensures we capture value from annual subscriptions and don't lose value from monthly downgrades
    const isIntervalUpgrade = currentInterval === 'monthly' && newInterval === 'annual';
    const isIntervalDowngrade = currentInterval === 'annual' && newInterval === 'monthly';
    
    // Handle interval changes during trial
    // Use direct updates (no schedules) to avoid proration previews
    // At trial end, user is charged full amount of whatever plan/interval is set
    if (isInTrial) {
      if (isIntervalUpgrade) {
        // Monthly → Annual during trial: Direct update (no schedule)
        // User gets annual plan immediately, but no charge until trial ends
        console.log('🔍 Trial interval change - Monthly→Annual, applying directly, no schedule to avoid proration preview');
        
        // First, release any existing schedule (from previous changes)
        let scheduleId = subscription.schedule;
        if (!scheduleId) {
          try {
            const schedules = await stripe.subscriptionSchedules.list({
              customer: subscription.customer,
              limit: 10
            });
            const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
            if (matchingSchedule) {
              scheduleId = matchingSchedule.id;
            }
          } catch (listError) {
            console.log('🔍 Could not list schedules:', listError.message);
          }
        }
        
        if (scheduleId) {
          console.log('🔍 Found schedule during trial interval upgrade, releasing it');
          await stripe.subscriptionSchedules.release(scheduleId);
          subscription = await stripe.subscriptions.retrieve(subscription.id);
          // After releasing schedule, trial_end might be lost - preserve it
          if (subscription.trial_end !== trialEnd && trialEnd && !hasTrialEnded) {
            console.log('🔍 Trial_end changed after schedule release, preserving original trial_end');
          }
        }
        
        // Direct update: Change to annual immediately, preserve trial_end only if trial hasn't ended
        const updateParams = {
          items: [{
            id: subscription.items.data[0].id,
            price: newPriceId, // Annual price
          }],
          proration_behavior: 'none', // ✅ No proration during trial
          metadata: {
            userId: userId,
            planId: subscription.metadata.planId, // Keep current plan
            interval: 'annual', // Update to annual immediately
            scheduledPlanId: null, // Clear scheduled changes
            scheduledInterval: null,
            scheduledChangeDate: null
          }
        };
        
        // CRITICAL: Always preserve trial_end if trial hasn't ended (especially after schedule release)
        if (trialEnd && !hasTrialEnded) {
          updateParams.trial_end = trialEnd; // ✅ PRESERVE trial_end only if trial is still active
        }
        
        // If subscription is pending cancellation, cancel the cancellation
        if (subscription.cancel_at_period_end) {
          updateParams.cancel_at_period_end = false;
          console.log('🔍 Trial interval upgrade from pending cancellation - canceling the cancellation');
        }
        
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);
        
        return res.json({
          success: true,
          message: 'Billing interval changed to annual. Full annual amount will be charged at trial end.',
          subscription: updatedSubscription,
          newInterval: newInterval
        });
      } else if (isIntervalDowngrade) {
        // Annual → Monthly during trial: Direct update (no schedule)
        // User gets monthly plan immediately, but no charge until trial ends
        console.log('🔍 Trial interval change - Annual→Monthly, applying directly, no schedule to avoid proration preview');
        
        // First, release any existing schedule (from previous changes)
        let scheduleId = subscription.schedule;
        if (!scheduleId) {
          try {
            const schedules = await stripe.subscriptionSchedules.list({
              customer: subscription.customer,
              limit: 10
            });
            const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
            if (matchingSchedule) {
              scheduleId = matchingSchedule.id;
            }
          } catch (listError) {
            console.log('🔍 Could not list schedules:', listError.message);
          }
        }
        
        if (scheduleId) {
          console.log('🔍 Found schedule during trial interval downgrade, releasing it');
          await stripe.subscriptionSchedules.release(scheduleId);
          subscription = await stripe.subscriptions.retrieve(subscription.id);
        }
        
        // Direct update: Change to monthly immediately, preserve trial_end only if trial hasn't ended
        const updateParams = {
          items: [{
            id: subscription.items.data[0].id,
            price: newPriceId, // Monthly price
          }],
          proration_behavior: 'none', // ✅ No proration during trial
          metadata: {
            userId: userId,
            planId: subscription.metadata.planId, // Keep current plan
            interval: 'monthly', // Update to monthly immediately
            scheduledPlanId: null, // Clear scheduled changes
            scheduledInterval: null,
            scheduledChangeDate: null
          }
        };
        
        // Only preserve trial_end if trial hasn't ended (Stripe rejects past trial_end values)
        if (trialEnd && !hasTrialEnded) {
          updateParams.trial_end = trialEnd; // ✅ PRESERVE trial_end only if trial is still active
        }
        
        // If subscription is pending cancellation, cancel the cancellation
        if (subscription.cancel_at_period_end) {
          updateParams.cancel_at_period_end = false;
          console.log('🔍 Trial interval downgrade from pending cancellation - canceling the cancellation');
        }
        
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);
        
        return res.json({
          success: true,
          message: 'Billing interval changed to monthly. Full monthly amount will be charged at trial end.',
          subscription: updatedSubscription,
          newInterval: newInterval
        });
      } else {
        // Same interval (shouldn't happen, but handle gracefully)
        return res.status(400).json({ 
          error: 'No interval change needed' 
        });
      }
    }

  // Monthly -> Annual (upgrade): charge immediately, start a new annual period today
  if (currentInterval === 'monthly' && newInterval === 'annual') {
    // ✅ CRITICAL: Guard against trial subscriptions - this path should NOT execute during trial
    // Use hasTrialEnded check (same as trial detection logic) to handle ended trials correctly
    const trialEndForGuard = subscription.trial_end;
    const hasTrialEndedForGuard = trialEndForGuard !== null && 
                                   subscription.current_period_end > trialEndForGuard;
    const isInTrialForGuard = !hasTrialEndedForGuard && (
      subscription.status === 'trialing' || 
      (trialEndForGuard !== null && trialEndForGuard > Date.now() / 1000)
    );
    
    if (isInTrialForGuard) {
      console.error('❌ Attempted non-trial path for trial subscription - this should not happen!');
      console.error('🔍 Subscription trial_end:', subscription.trial_end);
      console.error('🔍 Current time:', Date.now() / 1000);
      console.error('🔍 Has trial ended:', hasTrialEndedForGuard);
      return res.status(400).json({ 
        error: 'Cannot change interval during trial - use trial-specific path' 
      });
    }
    
    // First, check if there's an active subscription schedule and release it
    // This ensures proration is calculated from the actual current plan, not scheduled plan
    // Using release() instead of cancel() to avoid canceling the subscription
    console.log('🔍 Checking for subscription schedules for subscription:', subscription.id);
    try {
      // Check subscription.schedule property first
      let scheduleId = subscription.schedule;
      
      // If not found, list schedules by customer
      if (!scheduleId) {
      const schedules = await stripe.subscriptionSchedules.list({
          customer: subscription.customer,
          limit: 10
        });
        
        const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
        if (matchingSchedule) {
          scheduleId = matchingSchedule.id;
        }
      }
      
      if (scheduleId) {
        console.log('🔍 Found active subscription schedule:', scheduleId, 'releasing it before interval upgrade');
        await stripe.subscriptionSchedules.release(scheduleId);
        console.log('🔍 Subscription schedule released successfully');
        
        // Retrieve the subscription again to get its current state after schedule release
        subscription = await stripe.subscriptions.retrieve(subscription.id);
      } else {
        console.log('🔍 No subscription schedules found');
      }
    } catch (scheduleError) {
      console.error('🔍 Error releasing subscription schedule:', scheduleError.message);
      return res.status(500).json({ 
        error: 'Failed to update subscription. Please try again or contact support.' 
      });
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
  // ✅ CRITICAL FIX: Use subscription schedule (like plan downgrades) instead of direct update
  if (currentInterval === 'annual' && newInterval === 'monthly') {
    // ✅ CRITICAL: Guard against trial subscriptions - this path should NOT execute during trial
    // Use hasTrialEnded check (same as trial detection logic) to handle ended trials correctly
    const trialEndForGuard = subscription.trial_end;
    const hasTrialEndedForGuard = trialEndForGuard !== null && 
                                   subscription.current_period_end > trialEndForGuard;
    const isInTrialForGuard = !hasTrialEndedForGuard && (
      subscription.status === 'trialing' || 
      (trialEndForGuard !== null && trialEndForGuard > Date.now() / 1000)
    );
    
    if (isInTrialForGuard) {
      console.error('❌ Attempted non-trial path for trial subscription - this should not happen!');
      console.error('🔍 Subscription trial_end:', subscription.trial_end);
      console.error('🔍 Current time:', Date.now() / 1000);
      console.error('🔍 Has trial ended:', hasTrialEndedForGuard);
      return res.status(400).json({ 
        error: 'Cannot change interval during trial - use trial-specific path' 
      });
    }
    
    // ✅ Use subscription schedule for Annual → Monthly downgrade (like plan downgrades)
    // This preserves current_period_end until the change takes effect
    try {
      // Check if subscription already has a schedule
      let scheduleId = subscription.schedule;
      let existingSchedule = null;
      
      if (!scheduleId) {
        try {
          const schedules = await stripe.subscriptionSchedules.list({
            customer: subscription.customer,
            limit: 10
          });
          const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
          if (matchingSchedule) {
            scheduleId = matchingSchedule.id;
            existingSchedule = matchingSchedule;
          }
        } catch (listError) {
          console.log('🔍 Could not list schedules:', listError.message);
        }
      } else {
        // If schedule ID exists, retrieve the schedule
        try {
          existingSchedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
        } catch (retrieveError) {
          console.log('🔍 Could not retrieve schedule:', retrieveError.message);
        }
      }
      
      if (existingSchedule && scheduleId) {
        // ✅ Update existing schedule instead of creating new one
        console.log('🔍 Found existing schedule:', scheduleId, 'updating it for interval downgrade');
        await stripe.subscriptionSchedules.update(scheduleId, {
          metadata: {
            userId: userId,
            planId: effectivePlanId,
            interval: currentInterval,
            scheduledInterval: 'monthly',
          },
          phases: [
            {
              items: [{
                price: subscription.items.data[0].price.id, // Keep current annual price
                quantity: 1,
              }],
              start_date: subscription.current_period_start,
              end_date: subscription.current_period_end, // Preserve current period end
            },
            {
              items: [{
                price: newPriceId, // Monthly price starts after current period
                quantity: 1,
              }],
              start_date: subscription.current_period_end, // Start after current period
            }
          ]
        });

        return res.json({
          success: true,
          message: subscription.cancel_at_period_end ? 
            'Billing interval change to monthly scheduled for end of period and cancellation canceled' :
            'Billing interval change to monthly scheduled for end of period',
          scheduleId: scheduleId,
          newInterval: newInterval,
          effectiveDate: subscription.current_period_end
        });
      } else {
        // No existing schedule - create new one
        console.log('🔍 No existing schedule found, creating new one for interval downgrade');
        
        // Step 1: Create schedule from subscription (without phases or metadata)
        // NOTE: Stripe doesn't allow setting metadata or phases when from_subscription is set
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscription.id
        });
        
        // Step 2: Update schedule with phases and metadata
        await stripe.subscriptionSchedules.update(schedule.id, {
          metadata: {
            userId: userId,
            planId: effectivePlanId,
            interval: currentInterval,
            scheduledInterval: 'monthly',
          },
          phases: [
            {
              items: [{
                price: subscription.items.data[0].price.id, // Keep current annual price
                quantity: 1,
              }],
              start_date: subscription.current_period_start,
              end_date: subscription.current_period_end, // Preserve current period end
            },
            {
              items: [{
                price: newPriceId, // Monthly price starts after current period
                quantity: 1,
              }],
              start_date: subscription.current_period_end, // Start after current period
            }
          ]
        });

        return res.json({
          success: true,
          message: subscription.cancel_at_period_end ? 
            'Billing interval change to monthly scheduled for end of period and cancellation canceled' :
            'Billing interval change to monthly scheduled for end of period',
          scheduleId: schedule.id,
          newInterval: newInterval,
          effectiveDate: subscription.current_period_end
        });
      }
    } catch (scheduleError) {
      console.error('Subscription schedule error:', scheduleError);
      // Fallback to metadata-only approach if schedules fail
      const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        metadata: {
          userId: userId,
          planId: effectivePlanId,
          interval: currentInterval,
          scheduledInterval: 'monthly',
          scheduledChangeDate: subscription.current_period_end
        }
      });
      
      return res.json({
        success: true,
        message: 'Billing interval change to monthly scheduled for end of period (metadata only)',
        subscription: updatedSubscription,
        newInterval: newInterval,
        effectiveDate: subscription.current_period_end
      });
    }
  }

  // ✅ EDGE CASE FIX: Handle canceling scheduled interval change
  // If currentInterval === newInterval but there's a scheduled change, cancel it
  if (currentInterval === newInterval) {
    const scheduledInterval = subscription.metadata?.scheduledInterval;
    
    // Check if there's a scheduled change to cancel
    if (scheduledInterval && scheduledInterval !== currentInterval) {
      console.log('🔍 Canceling scheduled interval change:', scheduledInterval, '→ keeping', currentInterval);
      
      // Check if subscription has a schedule
      let scheduleId = subscription.schedule;
      let hasSchedule = false;
      
      if (!scheduleId) {
        try {
          const schedules = await stripe.subscriptionSchedules.list({
            customer: subscription.customer,
            limit: 10
          });
          const matchingSchedule = schedules.data.find(s => s.subscription === subscription.id);
          if (matchingSchedule) {
            scheduleId = matchingSchedule.id;
            hasSchedule = true;
          }
        } catch (listError) {
          console.log('🔍 Could not list schedules:', listError.message);
        }
      } else {
        hasSchedule = true;
      }
      
      // Track if we release a schedule (to know if we should clear scheduledPlanId too)
      let scheduleWasReleased = false;
      
      if (hasSchedule && scheduleId) {
        // Release the schedule to cancel the scheduled change
        // Note: If schedule has both plan and interval changes, releasing cancels both
        try {
          await stripe.subscriptionSchedules.release(scheduleId);
          console.log('🔍 Released schedule to cancel scheduled interval change');
          scheduleWasReleased = true;
          subscription = await stripe.subscriptions.retrieve(subscription.id);
        } catch (releaseError) {
          console.error('🔍 Error releasing schedule:', releaseError.message);
          // Continue with metadata update even if schedule release fails
        }
      }
      
      // Clear scheduled interval change in metadata
      // If schedule was released, also clear scheduledPlanId (schedule might have had both changes)
      // If no schedule existed, only clear scheduledInterval (metadata-only change)
      const updateParams = {
        metadata: {
          userId: userId,
          planId: subscription.metadata.planId,
          interval: currentInterval, // Keep current interval
          scheduledInterval: null, // Always clear scheduled interval change
          scheduledPlanId: scheduleWasReleased ? null : subscription.metadata.scheduledPlanId, // Clear if schedule was released
          scheduledChangeDate: null
        }
      };
      
      // If no schedule was released, check if scheduledPlanId should be preserved
      // (Only preserve if it's a real plan change, not just for interval-only change)
      if (!scheduleWasReleased) {
        if (!subscription.metadata.scheduledPlanId || subscription.metadata.scheduledPlanId === subscription.metadata.planId) {
          updateParams.metadata.scheduledPlanId = null;
        }
      }
      
      const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams);
      
      return res.json({
        success: true,
        message: 'Scheduled interval change canceled. Your subscription will remain on ' + currentInterval + ' billing.',
        subscription: updatedSubscription,
        newInterval: newInterval
      });
    }
    
    // No scheduled change - already at requested interval
    return res.status(400).json({ 
      error: `No interval change needed. Your subscription is already on ${currentInterval} billing.` 
    });
  }

  // No-op or unsupported transition
  return res.status(400).json({ error: `No interval change performed from ${currentInterval} to ${newInterval}` })
  } catch (error) {
    console.error('Change interval error:', error);
    res.status(500).json({ error: 'Failed to change billing interval' });
  }
});

module.exports = router;
