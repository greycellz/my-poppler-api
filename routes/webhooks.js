const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

// Initialize Stripe with secret key
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe webhook endpoint
router.post('/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 Received Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object);
        break;
      
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle subscription creation
async function handleSubscriptionCreated(subscription) {
  try {
    console.log(`✅ Processing subscription created: ${subscription.id}`);
    
    const customerId = subscription.customer;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document with subscription info
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    
    await gcpClient.firestore.collection('users').doc(userId).update({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: planId,
      interval: interval,
      currentPeriodEnd: subscription.current_period_end,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ User ${userId} subscription created: ${planId} (${interval})`);
  } catch (error) {
    console.error('❌ Error handling subscription created:', error);
  }
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription) {
  try {
    console.log(`🔄 Processing subscription updated: ${subscription.id}`);
    
    const customerId = subscription.customer;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document with new subscription info
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    
    await gcpClient.firestore.collection('users').doc(userId).update({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: planId,
      interval: interval,
      currentPeriodEnd: subscription.current_period_end,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ User ${userId} subscription updated: ${planId} (${interval}) - Status: ${subscription.status}`);
  } catch (error) {
    console.error('❌ Error handling subscription updated:', error);
  }
}

// Handle subscription deletion/cancellation
async function handleSubscriptionDeleted(subscription) {
  try {
    console.log(`🗑️ Processing subscription deleted: ${subscription.id}`);
    
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document to remove subscription
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    
    await gcpClient.firestore.collection('users').doc(userId).update({
      subscriptionId: null,
      subscriptionStatus: 'canceled',
      planId: 'free',
      interval: null,
      currentPeriodEnd: null,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ User ${userId} subscription canceled - reverted to free plan`);
  } catch (error) {
    console.error('❌ Error handling subscription deleted:', error);
  }
}

// Handle successful payment
async function handlePaymentSucceeded(invoice) {
  try {
    console.log(`💰 Processing payment succeeded: ${invoice.id}`);
    
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = subscription.metadata.userId;

      if (userId) {
        // Update user's last payment date
        const GCPClient = require('../gcp-client');
        const gcpClient = new GCPClient();
        
        await gcpClient.firestore.collection('users').doc(userId).update({
          lastPaymentDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        console.log(`✅ Payment recorded for user ${userId}`);
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment succeeded:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(invoice) {
  try {
    console.log(`💳 Processing payment failed: ${invoice.id}`);
    
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = subscription.metadata.userId;

      if (userId) {
        // Update user's payment status
        const GCPClient = require('../gcp-client');
        const gcpClient = new GCPClient();
        
        await gcpClient.firestore.collection('users').doc(userId).update({
          paymentFailed: true,
          lastPaymentFailure: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        console.log(`⚠️ Payment failure recorded for user ${userId}`);
        
        // TODO: Send email notification about failed payment
        // This would integrate with your email service (SendGrid, etc.)
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment failed:', error);
  }
}

// Handle trial ending soon
async function handleTrialWillEnd(subscription) {
  try {
    console.log(`⏰ Processing trial will end: ${subscription.id}`);
    
    const userId = subscription.metadata.userId;

    if (userId) {
      // TODO: Send email notification about trial ending
      // This would integrate with your email service (SendGrid, etc.)
      console.log(`📧 Trial ending notification needed for user ${userId}`);
    }
  } catch (error) {
    console.error('❌ Error handling trial will end:', error);
  }
}

module.exports = router;
