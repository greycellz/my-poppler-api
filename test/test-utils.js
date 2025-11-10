/**
 * Test Utilities for Subscription Tests
 * 
 * Provides helper functions for creating test users, subscriptions, and managing test data
 */

// Load test secrets FIRST before any other imports that might use them
let testSecrets = {};
try {
  testSecrets = require('./test-secrets');
} catch (e) {
  // test-secrets.js not found, use environment variables
}

// Set JWT_SECRET FIRST before auth/utils is imported (it reads JWT_SECRET on load)
if (testSecrets.JWT_SECRET && !process.env.JWT_SECRET) {
  process.env.JWT_SECRET = testSecrets.JWT_SECRET;
}

// Set GCP credentials if provided in test-secrets
if (testSecrets.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(testSecrets.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

const GCPClient = require('../gcp-client');
const { generateToken } = require('../auth/utils');
const Stripe = require('stripe');

// Initialize Stripe with secret from test-secrets or environment
const stripeSecret = testSecrets.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret 
  ? new Stripe(stripeSecret)
  : null;

const gcpClient = new GCPClient();

// Price IDs from routes/billing.js
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

/**
 * Create a test user in Firestore
 */
async function createTestUser(options = {}) {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  const userId = `test-user-${timestamp}-${randomId}`;
  const email = options.email || `test-${timestamp}@chatterforms.test`;

  const userData = {
    email: email,
    name: options.name || `Test User ${timestamp}`,
    createdAt: new Date(),
    subscription: {
      plan: options.plan || 'free',
      status: options.status || 'active',
      interval: options.interval || 'monthly',
      ...options.subscriptionData
    },
    hasHadPaidSubscription: options.hasHadPaidSubscription || false,
    stripeCustomerId: null, // Will be set when customer is created
    ...options.additionalData
  };

  await gcpClient.firestore.collection('users').doc(userId).set(userData);

  return {
    userId,
    email,
    userData
  };
}

/**
 * Create a Stripe customer
 */
async function createStripeCustomer(options = {}) {
  if (!stripe) {
    throw new Error('Stripe not initialized. Set STRIPE_SECRET_KEY environment variable.');
  }

  const timestamp = Date.now();
  const email = options.email || `test-${timestamp}@chatterforms.test`;
  const testClockId = options.testClockId || null;

  const customerData = {
    email: email,
    name: options.name || `Test Customer ${timestamp}`,
    metadata: {
      test: 'true',
      userId: options.userId || 'test-user-id'
    }
  };

  if (testClockId) {
    customerData.test_clock = testClockId;
  }

  const customer = await stripe.customers.create(customerData);

  return customer;
}

/**
 * Link Stripe customer to Firestore user
 */
async function linkCustomerToUser(userId, customerId) {
  await gcpClient.firestore.collection('users').doc(userId).update({
    stripeCustomerId: customerId
  });
}

/**
 * Attach a test payment method to a customer
 * Uses Stripe's predefined test payment method IDs (pm_card_visa, etc.)
 * These work without needing raw card data APIs enabled
 */
async function attachTestPaymentMethod(customerId) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  try {
    // Try using Stripe's predefined test payment method IDs first
    // These work without raw card data APIs: pm_card_visa, pm_card_mastercard, etc.
    const testPaymentMethodId = 'pm_card_visa'; // Stripe's predefined test Visa payment method
    
    try {
      // Attach the test payment method to the customer
      await stripe.paymentMethods.attach(testPaymentMethodId, {
        customer: customerId
      });

      // Set as default payment method
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: testPaymentMethodId
        }
      });

      console.log('✅ Attached test payment method (pm_card_visa) to customer');
      return { id: testPaymentMethodId, type: 'card' };
    } catch (attachError) {
      // If predefined payment method doesn't work, try creating via SetupIntent
      console.log('⚠️  Predefined payment method not attachable, trying SetupIntent approach...');
      
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        payment_method: testPaymentMethodId
      });

      // Confirm the setup intent
      const confirmedSetupIntent = await stripe.setupIntents.confirm(setupIntent.id);
      
      if (confirmedSetupIntent.payment_method) {
        // Set as default payment method
        await stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: confirmedSetupIntent.payment_method
          }
        });
        
        console.log('✅ Created payment method via SetupIntent');
        return { id: confirmedSetupIntent.payment_method, type: 'card' };
      }
      
      throw new Error('Could not create payment method via SetupIntent');
    }
  } catch (error) {
    // If all methods fail, log warning but continue
    // Trial subscriptions don't require payment methods until trial ends
    console.warn('⚠️  Could not attach payment method:', error.message);
    console.warn('   Trial subscriptions will work, but subscription updates may fail.');
    console.warn('   To fix: Enable "Raw card data APIs" in Stripe Dashboard > Settings > Developers > API keys');
    return null;
  }
}

/**
 * Create a complete test user with Stripe customer
 */
async function createTestUserWithCustomer(options = {}) {
  const { userId, email, userData } = await createTestUser(options);
  const customer = await createStripeCustomer({
    email,
    userId,
    testClockId: options.testClockId
  });
  
  // Attach a test payment method (required for subscription updates)
  // Note: This may fail if raw card data APIs aren't enabled, but trial subscriptions don't need it immediately
  try {
    await attachTestPaymentMethod(customer.id);
  } catch (error) {
    console.warn('⚠️  Could not attach payment method:', error.message);
    console.warn('   This is OK for trial subscriptions, but updates may fail.');
  }
  
  await linkCustomerToUser(userId, customer.id);

  return {
    userId,
    email,
    customerId: customer.id,
    customer,
    userData
  };
}

/**
 * Generate JWT token for test user
 */
function generateTestToken(userId, email) {
  return generateToken(userId, email);
}

/**
 * Create a subscription with trial
 */
async function createTrialSubscription(customerId, planId, interval, options = {}) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  const priceId = PRICE_IDS[planId]?.[interval];
  if (!priceId) {
    throw new Error(`Invalid plan or interval: ${planId}/${interval}`);
  }

  const subscriptionData = {
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: options.trialDays || 30,
    metadata: {
      userId: options.userId || 'test-user-id',
      planId: planId,
      interval: interval
    }
  };

  const subscription = await stripe.subscriptions.create(subscriptionData);

  return subscription;
}

/**
 * Create an active subscription (no trial)
 */
async function createActiveSubscription(customerId, planId, interval, options = {}) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  const priceId = PRICE_IDS[planId]?.[interval];
  if (!priceId) {
    throw new Error(`Invalid plan or interval: ${planId}/${interval}`);
  }

  const subscriptionData = {
    customer: customerId,
    items: [{ price: priceId }],
    metadata: {
      userId: options.userId || 'test-user-id',
      planId: planId,
      interval: interval
    }
  };

  const subscription = await stripe.subscriptions.create(subscriptionData);

  return subscription;
}

/**
 * Create a subscription schedule
 */
async function createSubscriptionSchedule(subscriptionId, phases, options = {}) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  const scheduleData = {
    from_subscription: subscriptionId,
    phases: phases,
    metadata: {
      userId: options.userId || 'test-user-id',
      ...options.metadata
    }
  };

  const schedule = await stripe.subscriptionSchedules.create(scheduleData);

  return schedule;
}

/**
 * Update subscription metadata
 */
async function updateSubscriptionMetadata(subscriptionId, metadata) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  const subscription = await stripe.subscriptions.update(subscriptionId, {
    metadata: metadata
  });

  return subscription;
}

/**
 * Cancel a subscription
 */
async function cancelSubscription(subscriptionId, cancelAtPeriodEnd = true) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd
  });

  return subscription;
}

/**
 * Release a subscription schedule
 */
async function releaseSchedule(scheduleId) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  const schedule = await stripe.subscriptionSchedules.release(scheduleId);

  return schedule;
}

/**
 * Clean up test user from Firestore
 */
async function cleanupTestUser(userId) {
  try {
    await gcpClient.firestore.collection('users').doc(userId).delete();
  } catch (error) {
    console.warn(`Failed to cleanup test user ${userId}:`, error.message);
  }
}

/**
 * Clean up Stripe customer (and all associated subscriptions)
 */
async function cleanupStripeCustomer(customerId) {
  if (!stripe) {
    return;
  }

  try {
    // Cancel all subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 100
    });

    for (const sub of subscriptions.data) {
      try {
        if (sub.status !== 'canceled') {
          await stripe.subscriptions.cancel(sub.id);
        }
      } catch (error) {
        console.warn(`Failed to cancel subscription ${sub.id}:`, error.message);
      }
    }

    // Delete customer
    await stripe.customers.del(customerId);
  } catch (error) {
    console.warn(`Failed to cleanup Stripe customer ${customerId}:`, error.message);
  }
}

/**
 * Clean up test clock
 */
async function cleanupTestClock(testClockId) {
  if (!stripe || !testClockId) {
    return;
  }

  try {
    // Note: Test clocks can't be deleted while in use
    // They will be automatically cleaned up by Stripe
    // This is just a placeholder for future cleanup if needed
  } catch (error) {
    console.warn(`Failed to cleanup test clock ${testClockId}:`, error.message);
  }
}

/**
 * Wait for Stripe to process (for test clock advancements)
 */
function waitForStripeProcessing(ms = 2000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Advance test clock
 */
async function advanceTestClock(testClockId, frozenTime) {
  if (!stripe) {
    throw new Error('Stripe not initialized.');
  }

  await stripe.testHelpers.testClocks.advance(testClockId, {
    frozen_time: frozenTime
  });
}

/**
 * Get price ID for plan and interval
 */
function getPriceId(planId, interval) {
  return PRICE_IDS[planId]?.[interval];
}

module.exports = {
  createTestUser,
  createStripeCustomer,
  linkCustomerToUser,
  attachTestPaymentMethod,
  createTestUserWithCustomer,
  generateTestToken,
  createTrialSubscription,
  createActiveSubscription,
  createSubscriptionSchedule,
  updateSubscriptionMetadata,
  cancelSubscription,
  releaseSchedule,
  cleanupTestUser,
  cleanupStripeCustomer,
  cleanupTestClock,
  waitForStripeProcessing,
  advanceTestClock,
  getPriceId,
  PRICE_IDS
};

