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
    const customerId = req.user.stripeCustomerId;

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
    const customerId = req.user.stripeCustomerId;

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

    res.json({
      plan: planId,
      status: subscription.status,
      interval: interval,
      currentPeriodEnd: subscription.current_period_end,
      hipaaEnabled: planId === 'pro' || planId === 'enterprise'
    });
  } catch (error) {
    console.error('Stripe subscription retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve subscription' });
  }
});

module.exports = router;
