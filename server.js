const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');
const puppeteer = require('puppeteer');
const Stripe = require('stripe');
const session = require('express-session');

const app = express();
const poppler = new Poppler();
const PORT = process.env.PORT || 3000; // Keep 3000 to match existing Dockerfile
// Updated: Refresh button UI enhancements and form validation improvements

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY. Please set it in Railway/Vercel environment variables.');
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-11-17.clover'
});

// Trust proxy for Railway deployment (fixes rate limiter warnings)
app.set('trust proxy', 1);

// Initialize GCP Client
const GCPClient = require('./gcp-client');
const gcpClient = new GCPClient();
const { Firestore } = require('@google-cloud/firestore');

// Initialize Email Service
const emailService = require('./email-service');

// Import authentication and authorization middleware (must be before routes)
const { authenticateToken, requireAuth, optionalAuth } = require('./auth/middleware');
const { requireFormOwnership, requireSubmissionOwnership } = require('./auth/authorization');
const featureFlags = require('./config/feature-flags');

// Environment-aware base URL construction
const getBaseUrl = () => {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return `http://localhost:${PORT}`;
};

const BASE_URL = getBaseUrl();

console.log(`🌐 Base URL: ${BASE_URL}`);

// Create folders if not exist
['uploads', 'output', 'screenshots'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Stripe webhook endpoint needs raw body - must be before JSON parsing
app.post('/api/billing/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Enhanced logging for webhook debugging
  console.log('🔍 Webhook Debug - Endpoint: /api/billing/webhook');
  console.log('🔍 Webhook Debug - Signature header present:', !!sig);
  console.log('🔍 Webhook Debug - Webhook secret configured:', !!endpointSecret);
  console.log('🔍 Webhook Debug - Request body type:', typeof req.body);
  console.log('🔍 Webhook Debug - Request body length:', req.body?.length || 0);

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('🔍 Webhook Debug - Error details:', {
      endpoint: '/api/billing/webhook',
      hasSignature: !!sig,
      hasSecret: !!endpointSecret,
      bodyType: typeof req.body,
      bodyLength: req.body?.length || 0,
      errorType: err.constructor.name
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 Received Stripe webhook: ${event.type}`);
  console.log(`🔍 Webhook Debug - Event ID: ${event.id}`);
  console.log(`🔍 Webhook Debug - Event object keys:`, Object.keys(event.data?.object || {}));

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        console.log(`🔍 Handling subscription.created - subscription ID: ${event.data.object.id}, status: ${event.data.object.status}`);
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

// Webhook handler functions
async function handleSubscriptionCreated(subscription) {
  try {
    console.log(`✅ Processing subscription created: ${subscription.id}`);
    
    // Environment filtering: Skip if subscription belongs to different environment
    const subscriptionEnv = subscription.metadata?.environment;
    const currentEnv = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
    if (subscriptionEnv && subscriptionEnv !== currentEnv) {
      console.log(`ℹ️ Skipping webhook - subscription environment (${subscriptionEnv}) doesn't match current environment (${currentEnv})`);
      return;
    }
    
    const customerId = subscription.customer;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document with subscription info
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    const updateData = {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: planId,
      interval: interval,
      updatedAt: new Date().toISOString()
    };

    // Only add currentPeriodEnd if it exists
    if (subscription.current_period_end) {
      updateData.currentPeriodEnd = subscription.current_period_end;
    }

    await gcpClient.collection('users').doc(userId).update(updateData);

    console.log(`✅ User ${userId} subscription created: ${planId} (${interval})`);
    
    // Check if this is Pro/Enterprise and generate BAA PDF (for trial subscriptions, generate immediately)
    if (planId === 'pro' || planId === 'enterprise') {
      console.log('🔍 Checking for pending BAA signature on subscription creation...');
      
      try {
        // Query for pending BAA record
        const baaSnapshot = await gcpClient
          .collection('baa-agreements')
          .where('userId', '==', userId)
          .where('status', '==', 'pending_payment')
          .orderBy('signedAt', 'desc')
          .limit(1)
          .get();
        
        if (!baaSnapshot.empty) {
          const baaDoc = baaSnapshot.docs[0];
          const baaDocRef = baaDoc.ref;
          const baaData = baaDoc.data();
          
          // Check if PDF already generated (idempotency check)
          if (baaData.pdfUrl || baaData.pdfFilename) {
            console.log('ℹ️ BAA PDF already generated, skipping (idempotency check)');
            return;
          }
          
          // Atomic status update to prevent race conditions
          try {
            const updateResult = await baaDocRef.update({
              status: 'processing',
              processingStartedAt: new Date().toISOString()
            });
            
            // Double-check status was actually updated (prevent race condition)
            const verifyDoc = await baaDocRef.get();
            const verifyData = verifyDoc.data();
            
            if (verifyData.status !== 'processing') {
              console.log('ℹ️ BAA PDF generation already in progress by another webhook, skipping');
              return;
            }
            
            console.log('📝 Generating BAA PDF from subscription creation...');
            
            // Validate signature data exists
            if (!baaData.signatureData || !baaData.signatureData.imageBase64) {
              console.error('❌ Cannot generate BAA PDF: signature data missing or incomplete');
              // Revert status to pending_payment
              await baaDocRef.update({ status: 'pending_payment' });
              return;
            }
            
            // Get user data
            const userDoc = await gcpClient.collection('users').doc(userId).get();
            const userData = userDoc.data();
            
            // Generate PDF
            const BAAService = require('./baa-service');
            const baaService = new BAAService(gcpClient);
            
            const pdfResult = await baaService.generateBAAPDF(
              { 
                userId,
                name: userData?.name || 'Unknown',
                email: userData?.email || 'unknown@example.com',
                company: baaData.signatureData?.companyName || baaData.companyName || userData?.company
              },
              baaData.signatureData
            );
            
            // Update BAA record to completed
            const updateData = {
              status: 'completed',
              pdfUrl: pdfResult.url,
              pdfFilename: pdfResult.filename,
              completedAt: new Date().toISOString(),
              subscriptionId: subscription.id,
              emailSent: false // Initialize emailSent flag
            };
            
            // Only add baaHash if it exists (for verification)
            if (pdfResult.baaHash) {
              updateData.baaHash = pdfResult.baaHash;
            }
            
            await baaDocRef.update(updateData);
            
            console.log('✅ BAA PDF generated and record updated from subscription creation');
            
            // Use Firestore transaction to atomically check and update emailSent flag
            const webhookId = `sub-created-${Date.now()}`;
            await gcpClient.firestore.runTransaction(async (transaction) => {
              const baaDoc = await transaction.get(baaDocRef);
              const baaDocData = baaDoc.data();
              
              console.log(`🔍 [${webhookId}] Transaction email check - emailSent: ${baaDocData.emailSent}, status: ${baaDocData.status}`);
              
              if (!baaDocData.emailSent && baaDocData.status === 'completed') {
                // Mark as sending to prevent other transactions from sending
                transaction.update(baaDocRef, {
                  emailSent: true,
                  emailSentAt: new Date().toISOString()
                });
                return true; // Signal to send email
              }
              return false; // Don't send email
            }).then(async (shouldSendEmail) => {
              if (shouldSendEmail) {
                console.log(`📧 [${webhookId}] Sending BAA confirmation email from subscription creation...`);
                const emailService = require('./email-service');
                const emailResult = await emailService.sendBAAConfirmationEmail(
                  userData?.email || 'unknown@example.com',
                  userData?.name || 'User',
                  pdfResult.filename
                );
                
                console.log(`🔍 [${webhookId}] Email result:`, { success: emailResult.success, emailCallId: emailResult.emailCallId, messageId: emailResult.messageId });
                
                if (emailResult.success) {
                  console.log(`✅ [${webhookId}] BAA confirmation email sent and marked as sent from subscription creation`);
                } else {
                  // Revert emailSent flag if email failed
                  await baaDocRef.update({
                    emailSent: false
                  });
                  console.error(`❌ [${webhookId}] Failed to send BAA confirmation email, reverted flag:`, emailResult.error);
                }
              } else {
                console.log(`ℹ️ [${webhookId}] BAA confirmation email already sent or not completed, skipping (subscription creation)`);
              }
            });
          } catch (updateError) {
            // If update fails, another webhook might be processing
            console.log('ℹ️ Could not update BAA status to processing (likely already processing):', updateError.message);
            // Revert status if we set it to processing but generation failed
            try {
              const currentDoc = await baaDocRef.get();
              const currentData = currentDoc.data();
              if (currentData.status === 'processing') {
                await baaDocRef.update({ status: 'pending_payment' });
              }
            } catch (revertError) {
              console.error('❌ Error reverting BAA status:', revertError);
            }
            throw updateError;
          }
        } else {
          console.log('ℹ️ No pending BAA signature found for user');
        }
      } catch (baaError) {
        // Don't fail the subscription creation if BAA generation fails
        console.error('❌ Error generating BAA PDF from subscription creation (non-blocking):', baaError);
      }
    }
  } catch (error) {
    console.error('❌ Error handling subscription created:', error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    console.log(`🔄 Processing subscription updated: ${subscription.id}`);
    
    // Environment filtering: Skip if subscription belongs to different environment
    const subscriptionEnv = subscription.metadata?.environment;
    const currentEnv = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
    if (subscriptionEnv && subscriptionEnv !== currentEnv) {
      console.log(`ℹ️ Skipping webhook - subscription environment (${subscriptionEnv}) doesn't match current environment (${currentEnv})`);
      return;
    }
    
    const customerId = subscription.customer;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // CRITICAL: If subscription is canceled but still in trial, don't revert to free yet
    // The subscription should remain active until trial ends
    // CRITICAL: Also check if current_period_end > trial_end to detect ended trials
    const now = Date.now() / 1000;
    const trialEnd = subscription.trial_end;
    const hasTrialEnded = trialEnd !== null && 
                          subscription.current_period_end > trialEnd;
    const isInTrial = !hasTrialEnded && (
      subscription.status === 'trialing' || 
      (trialEnd !== null && trialEnd > now)
    );
    const isCanceled = subscription.status === 'canceled' || subscription.cancel_at_period_end;
    
    // If subscription is canceled but still in trial, keep the subscription active
    // Don't revert to free until trial actually ends
    if (isCanceled && isInTrial) {
      console.log(`⚠️ Subscription ${subscription.id} is canceled but still in trial - keeping subscription active until trial ends`);
      // Update subscription status but keep plan active
      const GCPClient = require('./gcp-client');
      const gcpClient = new GCPClient();
      
      const updateData = {
        subscriptionId: subscription.id,
        subscriptionStatus: 'trialing', // Keep as trialing even though canceled
        planId: planId,
        interval: interval,
        cancelAtPeriodEnd: true, // Mark as canceled but still active
        updatedAt: new Date().toISOString()
      };

      if (subscription.trial_end) {
        updateData.currentPeriodEnd = subscription.trial_end;
      } else if (subscription.current_period_end) {
        updateData.currentPeriodEnd = subscription.current_period_end;
      }

      await gcpClient.collection('users').doc(userId).update(updateData);
      console.log(`✅ User ${userId} subscription kept active during trial cancellation`);
      return;
    }

    // Update user document with new subscription info
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    const updateData = {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: planId,
      interval: interval,
      updatedAt: new Date().toISOString()
    };

    // Only add currentPeriodEnd if it exists
    if (subscription.current_period_end) {
      updateData.currentPeriodEnd = subscription.current_period_end;
    }

    // Track trial-to-paid conversion
    // Check if subscription was trialing and is now active
    // CRITICAL: Check both previous status AND previous trial_end to catch all trial conversions
    const previousTrialEnd = subscription.previous_attributes?.trial_end;
    const previousStatus = subscription.previous_attributes?.status;
    const wasTrialing = previousStatus === 'trialing' || 
                        (previousTrialEnd !== null && previousTrialEnd !== undefined && previousTrialEnd > (Date.now() / 1000));
    const isNowActive = subscription.status === 'active';
    
    if (wasTrialing && isNowActive) {
      // Trial converted to paid subscription
      updateData.hasHadPaidSubscription = true;
      updateData.trialConvertedAt = new Date().toISOString();
      
      console.log(`✅ Trial converted to paid for subscription ${subscription.id} (user ${userId})`);
    }

    await gcpClient.collection('users').doc(userId).update(updateData);

    console.log(`✅ User ${userId} subscription updated: ${planId} (${interval}) - Status: ${subscription.status}`);
    
    // Check if this is Pro/Enterprise upgrade and generate BAA PDF
    if (planId === 'pro' || planId === 'enterprise') {
      console.log('🔍 Checking for BAA agreement status...');
      
      try {
        // First, check if user already has a completed BAA (BAA is not tied to subscription, it persists)
        const completedBaaSnapshot = await gcpClient
          .collection('baa-agreements')
          .where('userId', '==', userId)
          .where('status', '==', 'completed')
          .orderBy('completedAt', 'desc')
          .limit(1)
          .get();
        
        if (!completedBaaSnapshot.empty) {
          console.log('ℹ️ User already has a completed BAA agreement - no need to regenerate');
          return; // BAA persists, no need to sign again
        }
        
        // If no completed BAA, check for pending BAA (user signed but payment not processed yet)
        const baaSnapshot = await gcpClient
          .collection('baa-agreements')
          .where('userId', '==', userId)
          .where('status', '==', 'pending_payment')
          .orderBy('signedAt', 'desc')
          .limit(1)
          .get();
        
        if (!baaSnapshot.empty) {
          const baaDoc = baaSnapshot.docs[0];
          const baaDocRef = baaDoc.ref;
          const baaData = baaDoc.data();
          
          // Check if PDF already generated (idempotency check)
          if (baaData.pdfUrl || baaData.pdfFilename) {
            console.log('ℹ️ BAA PDF already generated, skipping (idempotency check)');
            return;
          }
          
          // Atomic status update to prevent race conditions
          try {
            await baaDocRef.update({
              status: 'processing',
              processingStartedAt: new Date().toISOString()
            });
            
            // Double-check status was actually updated
            const verifyDoc = await baaDocRef.get();
            const verifyData = verifyDoc.data();
            
            if (verifyData.status !== 'processing') {
              console.log('ℹ️ BAA PDF generation already in progress by another webhook, skipping');
              return;
            }
            
            console.log('📝 Generating BAA PDF...');
            
            // Validate signature data exists
            if (!baaData.signatureData || !baaData.signatureData.imageBase64) {
              console.error('❌ Cannot generate BAA PDF: signature data missing or incomplete');
              // Revert status to pending_payment
              await baaDocRef.update({ status: 'pending_payment' });
              return;
            }
            
            // Get user data
            const userDoc = await gcpClient.collection('users').doc(userId).get();
            const userData = userDoc.data();
            
            // Generate PDF
            const BAAService = require('./baa-service');
            const baaService = new BAAService(gcpClient);
            
            const pdfResult = await baaService.generateBAAPDF(
              { 
                userId,
                name: userData?.name || 'Unknown',
                email: userData?.email || 'unknown@example.com',
                company: baaData.signatureData?.companyName || baaData.companyName || userData?.company
              },
              baaData.signatureData
            );
            
            // Update BAA record to completed
            const updateData = {
              status: 'completed',
              pdfUrl: pdfResult.url,
              pdfFilename: pdfResult.filename,
              completedAt: new Date().toISOString(),
              subscriptionId: subscription.id,
              emailSent: false // Initialize emailSent flag
            };
            
            // Only add baaHash if it exists (for verification)
            if (pdfResult.baaHash) {
              updateData.baaHash = pdfResult.baaHash;
            }
            
            await baaDocRef.update(updateData);
            
            console.log('✅ BAA PDF generated and record updated');
            
            // Use Firestore transaction to atomically check and update emailSent flag
            const webhookId = `sub-updated-${Date.now()}`;
            await gcpClient.firestore.runTransaction(async (transaction) => {
              const baaDoc = await transaction.get(baaDocRef);
              const baaDocData = baaDoc.data();
              
              console.log(`🔍 [${webhookId}] Transaction email check - emailSent: ${baaDocData.emailSent}, status: ${baaDocData.status}`);
              
              if (!baaDocData.emailSent && baaDocData.status === 'completed') {
                // Mark as sending to prevent other transactions from sending
                transaction.update(baaDocRef, {
                  emailSent: true,
                  emailSentAt: new Date().toISOString()
                });
                return true; // Signal to send email
              }
              return false; // Don't send email
            }).then(async (shouldSendEmail) => {
              if (shouldSendEmail) {
                console.log(`📧 [${webhookId}] Sending BAA confirmation email from subscription update...`);
                const emailService = require('./email-service');
                const emailResult = await emailService.sendBAAConfirmationEmail(
                  userData?.email || 'unknown@example.com',
                  userData?.name || 'User',
                  pdfResult.filename
                );
                
                console.log(`🔍 [${webhookId}] Email result:`, { success: emailResult.success, emailCallId: emailResult.emailCallId, messageId: emailResult.messageId });
                
                if (emailResult.success) {
                  console.log(`✅ [${webhookId}] BAA confirmation email sent and marked as sent from subscription update`);
                } else {
                  // Revert emailSent flag if email failed
                  await baaDocRef.update({
                    emailSent: false
                  });
                  console.error(`❌ [${webhookId}] Failed to send BAA confirmation email, reverted flag:`, emailResult.error);
                }
              } else {
                console.log(`ℹ️ [${webhookId}] BAA confirmation email already sent or not completed, skipping (subscription update)`);
              }
            });
          } catch (updateError) {
            // If update fails, another webhook might be processing
            console.log('ℹ️ Could not update BAA status to processing (likely already processing):', updateError.message);
            // Revert status if we set it to processing but generation failed
            try {
              const currentDoc = await baaDocRef.get();
              const currentData = currentDoc.data();
              if (currentData.status === 'processing') {
                await baaDocRef.update({ status: 'pending_payment' });
              }
            } catch (revertError) {
              console.error('❌ Error reverting BAA status:', revertError);
            }
            throw updateError;
          }
        } else {
          console.log('ℹ️ No pending BAA signature found for user');
        }
      } catch (baaError) {
        // Don't fail the subscription update if BAA generation fails
        console.error('❌ Error generating BAA PDF (non-blocking):', baaError);
      }
    }
  } catch (error) {
    console.error('❌ Error handling subscription updated:', error);
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    console.log(`🗑️ Processing subscription deleted: ${subscription.id}`);
    
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // CRITICAL: Check if subscription was in trial when deleted
    // If it was canceled during trial, the deleted event should only fire after trial ends
    // But if it fires prematurely, we should verify the subscription is actually deleted
    const wasInTrial = subscription.trial_end && subscription.trial_end > (Date.now() / 1000);
    
    if (wasInTrial) {
      console.log(`⚠️ Subscription ${subscription.id} was deleted but was in trial - this should not happen during trial cancellation`);
      console.log(`⚠️ Trial end was: ${new Date(subscription.trial_end * 1000).toISOString()}`);
      // Don't revert to free if subscription was in trial - wait for trial to actually end
      // The subscription.updated event should handle the cancellation status
      return;
    }

    // Update user document to remove subscription
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Check if user document exists before updating
    const userDoc = await gcpClient.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.warn(`⚠️ User document ${userId} does not exist - skipping update (likely test user or already deleted)`);
      return;
    }
    
    await gcpClient.collection('users').doc(userId).update({
      subscriptionId: null,
      subscriptionStatus: 'canceled',
      planId: 'free',
      interval: null,
      currentPeriodEnd: null,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ User ${userId} subscription canceled - reverted to free plan`);
  } catch (error) {
    // Handle Firestore "not found" errors gracefully (test users, deleted users, etc.)
    if (error.code === 5 || (error.message && error.message.includes('No document to update'))) {
      console.warn(`⚠️ User document not found for subscription deletion - skipping update (likely test user or already deleted): ${error.message}`);
      return;
    }
    console.error('❌ Error handling subscription deleted:', error);
  }
}

async function handlePaymentSucceeded(invoice) {
  try {
    console.log(`💰 Processing payment succeeded: ${invoice.id}`);
    console.log(`🔍 Payment webhook debug - invoice.subscription: ${invoice.subscription}, invoice.amount_paid: ${invoice.amount_paid}, invoice.billing_reason: ${invoice.billing_reason}`);
    
    // For trial creation invoices, subscription might be in lines.data[0].subscription
    let subscriptionId = invoice.subscription;
    if (!subscriptionId && invoice.lines?.data?.[0]?.subscription) {
      subscriptionId = invoice.lines.data[0].subscription;
      console.log(`🔍 Payment webhook debug - found subscription in invoice lines: ${subscriptionId}`);
    }
    
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      
      // Validate subscription was retrieved successfully
      if (!subscription || !subscription.metadata) {
        console.error('❌ Invalid subscription retrieved:', subscriptionId);
        return; // Skip BAA generation
      }
      
      const userId = subscription.metadata.userId;
      let planId = subscription.metadata.planId;
      
      // Fallback: If planId not in metadata, try to get from price ID
      if (!planId && subscription.items?.data?.[0]?.price?.id) {
        const priceId = subscription.items.data[0].price.id;
        // Reverse lookup from PRICE_IDS
        const PRICE_IDS = require('./routes/billing').PRICE_IDS || {};
        for (const [pId, intervals] of Object.entries(PRICE_IDS)) {
          for (const [interval, pIdValue] of Object.entries(intervals)) {
            if (pIdValue === priceId) {
              planId = pId;
              break;
            }
          }
          if (planId) break;
        }
      }

      console.log(`🔍 Payment webhook debug - userId: ${userId}, planId: ${planId}, subscription metadata:`, JSON.stringify(subscription.metadata));

      if (userId) {
        // Update user's last payment date
        const GCPClient = require('./gcp-client');
        const gcpClient = new GCPClient();
        
        await gcpClient.collection('users').doc(userId).update({
          lastPaymentDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        console.log(`✅ Payment recorded for user ${userId}`);
        
        // Note: BAA PDF generation is handled by subscription.created and subscription.updated webhooks
        // We do not generate BAA from payment webhooks to avoid race conditions and ensure
        // we rely on the correct, mutually exclusive events for BAA generation
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment succeeded:', error);
  }
}

async function handlePaymentFailed(invoice) {
  try {
    console.log(`💳 Processing payment failed: ${invoice.id}`);
    
    const subscription = invoice.subscription;
    if (!subscription) {
      console.log('⚠️ No subscription associated with failed invoice');
      return;
    }

    // Retrieve full subscription object to get metadata
    const fullSubscription = typeof subscription === 'string' 
      ? await stripe.subscriptions.retrieve(subscription)
      : subscription;
    
    const userId = fullSubscription.metadata.userId;
    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Get current user data to check existing failure tracking
    const userDoc = await gcpClient.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    
    // Track payment failure
    const failureCount = (userData.paymentFailureCount || 0) + 1;
    const now = new Date().toISOString();
    const firstFailureTime = userData.paymentFailedAt 
      ? new Date(userData.paymentFailedAt).getTime()
      : Date.now();
    
    // Update failure tracking
    const updateData = {
      paymentFailedAt: userData.paymentFailedAt || now, // Keep first failure time
      paymentFailureCount: failureCount,
      lastPaymentFailure: now,
      paymentFailed: true,
      updatedAt: now
    };
    
    await gcpClient.collection('users').doc(userId).update(updateData);
    
    // Check if this is after grace period (7 days)
    const daysSinceFirstFailure = (Date.now() - firstFailureTime) / (1000 * 60 * 60 * 24);
    
    if (daysSinceFirstFailure >= 7) {
      // Grace period ended, downgrade to free
      await gcpClient.collection('users').doc(userId).update({
        plan: 'free',
        planId: 'free',
        downgradedAt: now,
        downgradeReason: 'payment_failed_after_grace_period',
        updatedAt: now
      });
      
      console.log(`⚠️ Downgrading user ${userId} to free plan after payment failure grace period (${daysSinceFirstFailure.toFixed(1)} days)`);
    } else {
      const daysRemaining = 7 - daysSinceFirstFailure;
      console.log(`⚠️ Payment failed for subscription ${fullSubscription.id}. Grace period: ${daysRemaining.toFixed(1)} days remaining`);
    }
    
    // Optional: Send email notification (future enhancement)
    // await emailService.sendPaymentFailedEmail(userId, {
    //   amount: invoice.amount_due,
    //   dueDate: invoice.due_date,
    //   invoiceUrl: invoice.hosted_invoice_url,
    //   daysRemaining: Math.ceil(7 - daysSinceFirstFailure)
    // });
    
  } catch (error) {
    console.error('❌ Error handling payment failed:', error);
  }
}

async function handleTrialWillEnd(subscription) {
  try {
    console.log('═══════════════════════════════════════════════════');
    console.log(`⏰ Processing trial will end: ${subscription.id}`);
    console.log('═══════════════════════════════════════════════════');
    
    const userId = subscription.metadata.userId;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const trialEnd = subscription.trial_end;
    const currentPriceId = subscription.items.data[0].price.id;
    
    console.log(`   User: ${userId}`);
    console.log(`   Trial ends: ${trialEnd ? new Date(trialEnd * 1000).toISOString() : 'N/A'}`);
    console.log(`   Current plan: ${planId} (${interval})`);
    console.log(`   Current price: ${currentPriceId}`);
    
    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }
    
    // Note: Subscription items are already correct (updated during trial with proration_behavior: 'none')
    // Stripe will automatically:
    // - Transition status from 'trialing' to 'active'
    // - Generate invoice for first billing period
    // - Charge customer
    // - Set up auto-renewal (cancel_at_period_end: false)
    // - Set correct term dates (current_period_end = trial_end + interval)
    
    console.log('✅ Trial ending - Stripe will handle billing automatically');
    console.log('   Items already updated during trial (with proration_behavior: none)');
    console.log('   Stripe will generate invoice and charge customer');
    
    // Update Firestore to track trial ending (optional)
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    const trialEndDate = trialEnd ? new Date(trialEnd * 1000).toISOString() : null;
    
    try {
      await gcpClient.collection('users').doc(userId).update({
        trialEndingAt: trialEndDate,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ Updated Firestore for user ${userId}`);
    } catch (firestoreError) {
      console.log(`⚠️  Could not update Firestore: ${firestoreError.message}`);
      // Don't throw - Firestore update is optional
    }
    
    console.log('═══════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('❌ Error handling trial will end:', error);
  }
}

// Enable JSON parsing for other requests
app.use(express.json({ limit: '1mb' }));

// Configure file uploads with UUID-based naming (existing PDF logic)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uuid = req.uuid || uuidv4();
    req.uuid = uuid;
    cb(null, `${uuid}.pdf`);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Static folders
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
app.use(express.static(path.join(__dirname, 'public')));

// ============== CORS CONFIGURATION ==============

// Define allowed origins
// TODO: Move to CORS_ALLOWED_ORIGINS environment variable (comma-separated list)
const allowedOrigins = [
  'https://chatterforms.com',
  'https://www.chatterforms.com',
  'http://localhost:3000',  // Development
  'http://localhost:3001',  // Development alternate
  process.env.FRONTEND_URL,
].filter(Boolean); // Remove null values

console.log('🔐 CORS allowed origins:', allowedOrigins);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Check feature flag for strict CORS
  if (featureFlags.ENABLE_STRICT_CORS) {
    // Strict mode - only allow whitelisted origins
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      console.log(`✅ CORS: Origin allowed (strict): ${origin}`);
    } else {
      console.warn(`⚠️ CORS: Origin not in whitelist: ${origin}`);
      // Don't set CORS headers - browser will block
    }
  } else {
    // Permissive mode (for gradual rollout)
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      // Fallback to wildcard for backward compatibility
      res.header('Access-Control-Allow-Origin', '*');
      console.warn(`⚠️ CORS: Using wildcard for origin: ${origin || 'unknown'}`);
    }
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Session middleware for OAuth flow
app.use(session({
  secret: process.env.JWT_SECRET || 'fallback-secret-for-oauth',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000 // 10 minutes
  }
}));

// ============== UTILITY FUNCTIONS ==============

// Generate URL hash for caching
function generateUrlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

// Check if cached screenshot exists and is still valid (30 minutes)
function getCachedScreenshot(urlHash) {
  const screenshotDir = path.join(__dirname, 'screenshots', urlHash);
  const screenshotPath = path.join(screenshotDir, 'screenshot.png');
  
  if (fs.existsSync(screenshotPath)) {
    const stats = fs.statSync(screenshotPath);
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    
    if (stats.mtime.getTime() > thirtyMinutesAgo) {
      return {
        url: `${BASE_URL}/screenshots/${urlHash}/screenshot.png`,
        size: stats.size,
        cached: true
      };
    }
  }
  
  return null;
}

// Validate URL format
function validateUrl(url) {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    const urlObj = new URL(normalizedUrl);
    
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Only HTTP and HTTPS URLs are supported' };
    }
    
    return { isValid: true, normalizedUrl };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

// Capture screenshot with Puppeteer
async function captureFormScreenshot(url, urlHash, options = {}) {
  const screenshotDir = path.join(__dirname, 'screenshots', urlHash);
  const screenshotPath = path.join(screenshotDir, 'screenshot.png');
  
  // Create directory
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  let browser;
  const startTime = Date.now();

  try {
    // Detect environment and set browser options
    const isRailway = !!process.env.RAILWAY_PUBLIC_DOMAIN;
    const browserOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--memory-pressure-off',
        '--max_old_space_size=1024',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    };

    // Use system Chrome on Railway (via Dockerfile)
    if (isRailway && process.env.PUPPETEER_EXECUTABLE_PATH) {
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      console.log(`🐳 Using system Chrome: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    } else {
      console.log('💻 Using bundled Chromium');
    }

    // Launch browser with environment-specific settings
    browser = await puppeteer.launch(browserOptions);

    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ 
      width: options.viewport?.width || 1280, 
      height: options.viewport?.height || 800 
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    console.log(`📄 [DEBUG] Navigating to URL: ${url}`);
    const navigationStartTime = Date.now();
    
    // Navigate with timeout
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 45000
    });
    const navigationTime = Date.now() - navigationStartTime;
    console.log(`⏱️ [DEBUG] Navigation completed in ${navigationTime}ms`);

    // Wait for dynamic content
    const waitTime = options.waitTime || 4000;
    console.log(`⏳ [DEBUG] Waiting ${waitTime}ms for dynamic content...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Scroll to load content and find forms
    console.log('📜 [DEBUG] Scrolling page to load lazy content...');
    const scrollStartTime = Date.now();
    const scrollResult = await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            // Scroll back to top
            window.scrollTo(0, 0);
            setTimeout(() => {
              resolve({
                totalScrollHeight: scrollHeight,
                scrollDistance: totalHeight
              });
            }, 1000);
          }
        }, 100);
      });
    });
    const scrollTime = Date.now() - scrollStartTime;
    console.log(`⏱️ [DEBUG] Scrolling completed in ${scrollTime}ms`);
    console.log(`📊 [DEBUG] Scroll result:`, JSON.stringify(scrollResult, null, 2));

    // Get page metadata
    const pageTitle = await page.title();
    const finalUrl = page.url();
    
    // Get actual page dimensions
    const pageDimensions = await page.evaluate(() => {
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });

    console.log('📸 [DEBUG] Taking screenshot...');
    console.log('📐 [DEBUG] Page dimensions:', JSON.stringify(pageDimensions, null, 2));
    console.log('📐 [DEBUG] Viewport size:', options.viewport?.width || 1280, 'x', options.viewport?.height || 800);
    console.log('📐 [DEBUG] Full page screenshot:', options.fullPage !== false);
    
    // Take screenshot
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: options.fullPage !== false,
      type: 'png'
    });

    const loadTime = Date.now() - startTime;
    const stats = fs.statSync(screenshotPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const fileSizeKB = (stats.size / 1024).toFixed(2);

    console.log(`✅ [DEBUG] Screenshot captured: ${urlHash} (${loadTime}ms)`);
    console.log(`📊 [DEBUG] Screenshot file size: ${fileSizeMB} MB (${fileSizeKB} KB)`);
    console.log(`📊 [DEBUG] Screenshot dimensions: ${pageDimensions.width} x ${pageDimensions.height} pixels`);
    
    // Warn if screenshot is very large
    if (stats.size > 20 * 1024 * 1024) { // 20 MB
      console.warn(`⚠️ [DEBUG] WARNING: Screenshot exceeds 20 MB (${fileSizeMB} MB) - may cause issues with Vision API`);
    } else if (stats.size > 10 * 1024 * 1024) { // 10 MB
      console.warn(`⚠️ [DEBUG] WARNING: Screenshot is large (${fileSizeMB} MB) - consider optimization`);
    }

    return {
      url: `${BASE_URL}/screenshots/${urlHash}/screenshot.png`,
      size: stats.size,
      dimensions: {
        width: pageDimensions.width,
        height: pageDimensions.height
      },
      pageTitle,
      finalUrl,
      loadTime,
      viewport: { width: options.viewport?.width || 1280, height: options.viewport?.height || 800 },
      cached: false
    };

  } catch (error) {
    console.error('Screenshot capture error:', error);
    
    // Cleanup on failure
    try {
      if (fs.existsSync(screenshotDir)) {
        fs.rmSync(screenshotDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('Screenshot cleanup failed:', cleanupErr);
    }
    
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ============== EXISTING PDF ENDPOINTS ==============

app.post('/upload', 
  upload.single('pdf'),
  optionalAuth,  // ✅ Check for auth but don't require it yet (for gradual rollout)
  async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id
      
      // ✅ NEW: Check authentication requirement for PDF analysis
      if (featureFlags.ENABLE_FILE_UPLOAD_AUTH && !userId) {
        console.log(`❌ Unauthenticated PDF upload attempt blocked`);
        
        // Clean up uploaded file if it exists
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        
        return res.status(401).json({
          success: false,
          error: 'Authentication required for PDF analysis',
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Please sign in or create an account to analyze PDFs. PDF analysis helps us track usage and prevent abuse.',
          action: 'signup_or_login'
        });
      }

      const uuid = req.uuid || uuidv4();
      const pdfPath = path.join(__dirname, 'uploads', `${uuid}.pdf`);
      const outputDir = path.join(__dirname, 'output', uuid);
      const outputBase = path.join(outputDir, 'page');

      if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const options = {
      pngFile: true,
      firstPageToConvert: 1,
      lastPageToConvert: 0,
      singleFile: false,
      resolutionXYAxis: 150
    };

    await poppler.pdfToCairo(pdfPath, outputBase, options);

    const outputFiles = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/page-(\d+)\.png/)?.[1] || '0');
        const numB = parseInt(b.match(/page-(\d+)\.png/)?.[1] || '0');
        return numA - numB;
      });

    const imageUrls = outputFiles.map((file, index) => ({
      page: index + 1,
      filename: file,
      url: `${BASE_URL}/output/${uuid}/${file}`,
      size: fs.statSync(path.join(outputDir, file)).size
    }));

    console.log(`✅ PDF converted. UUID: ${uuid}, Pages: ${outputFiles.length}`);

    res.json({
      success: true,
      uuid: uuid,
      totalPages: outputFiles.length,
      images: imageUrls,
      baseUrl: BASE_URL,
      message: `Successfully converted ${outputFiles.length} page(s)`
    });

  } catch (err) {
    console.error("❌ PDF conversion failed:", err);
    
    try {
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error("⚠️ PDF cleanup failed:", cleanupErr);
    }

    res.status(500).json({
      success: false,
      error: 'PDF conversion failed',
      details: err.message
    });
  }
});

// ============== NEW SCREENSHOT ENDPOINT ==============

app.post('/screenshot', async (req, res) => {
  const { url, options = {} } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required',
      details: 'Please provide a valid URL to capture'
    });
  }

  // Validate URL
  const validation = validateUrl(url);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL',
      details: validation.error
    });
  }

  const normalizedUrl = validation.normalizedUrl;
  const urlHash = generateUrlHash(normalizedUrl);

  try {
    const endpointStartTime = Date.now();
    console.log('📸 [DEBUG] ========== SCREENSHOT ENDPOINT START ==========');
    console.log('📸 [DEBUG] Request URL:', normalizedUrl);
    console.log('📸 [DEBUG] URL Hash:', urlHash);
    console.log('📸 [DEBUG] Options:', JSON.stringify(options, null, 2));
    
    // Check for cached screenshot
    const cached = getCachedScreenshot(urlHash);
    if (cached) {
      const cacheTime = Date.now() - endpointStartTime;
      const cachedSizeMB = (cached.size / (1024 * 1024)).toFixed(2);
      console.log(`🎯 [DEBUG] Cache hit for URL hash: ${urlHash} (${cacheTime}ms)`);
      console.log(`📊 [DEBUG] Cached screenshot size: ${cachedSizeMB} MB`);
      console.log('📸 [DEBUG] ========== SCREENSHOT ENDPOINT END (CACHE) ==========');
      return res.json({
        success: true,
        urlHash: urlHash,
        screenshot: cached,
        metadata: {
          finalUrl: normalizedUrl,
          cached: true,
          cacheAge: '< 30 minutes'
        },
        message: 'Screenshot retrieved from cache'
      });
    }

    console.log(`📸 [DEBUG] Capturing new screenshot for: ${normalizedUrl}`);
    
    // Capture new screenshot
    const screenshot = await captureFormScreenshot(normalizedUrl, urlHash, options);
    const endpointTime = Date.now() - endpointStartTime;
    
    console.log(`⏱️ [DEBUG] Total endpoint processing time: ${endpointTime}ms`);
    console.log('📸 [DEBUG] ========== SCREENSHOT ENDPOINT END ==========');
    
    res.json({
      success: true,
      urlHash: urlHash,
      screenshot: {
        url: screenshot.url,
        size: screenshot.size,
        cached: false
      },
      metadata: {
        finalUrl: screenshot.finalUrl,
        pageTitle: screenshot.pageTitle,
        loadTime: screenshot.loadTime,
        viewport: screenshot.viewport,
        dimensions: screenshot.dimensions
      },
      message: 'Screenshot captured successfully'
    });

  } catch (error) {
    console.error('❌ Screenshot failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Screenshot capture failed',
      details: error.message,
      suggestions: [
        'Check if the URL is accessible and not behind authentication',
        'Verify the URL contains an actual form',
        'Try again in a few moments',
        'Consider uploading a manual screenshot instead'
      ]
    });
  }
});

// ============== CLEANUP ENDPOINTS ==============

// Manual cleanup for specific UUID (PDF)
app.delete('/cleanup/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  try {
    const pdfPath = path.join(__dirname, 'uploads', `${uuid}.pdf`);
    const outputDir = path.join(__dirname, 'output', uuid);
    
    let cleaned = [];

    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
      cleaned.push('PDF file');
    }

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
      cleaned.push('Output directory');
    }

    console.log(`🗑️ Cleaned up PDF UUID: ${uuid}`);

    res.json({
      success: true,
      uuid: uuid,
      cleaned: cleaned,
      message: cleaned.length > 0 ? 'Files cleaned successfully' : 'No files found to clean'
    });

  } catch (err) {
    console.error(`❌ PDF cleanup failed for UUID ${uuid}:`, err);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      details: err.message
    });
  }
});

// Manual cleanup for specific URL hash (Screenshot)
app.delete('/cleanup/screenshot/:urlHash', (req, res) => {
  const { urlHash } = req.params;
  
  try {
    const screenshotDir = path.join(__dirname, 'screenshots', urlHash);
    
    let cleaned = [];

    if (fs.existsSync(screenshotDir)) {
      fs.rmSync(screenshotDir, { recursive: true, force: true });
      cleaned.push('Screenshot directory');
    }

    console.log(`🗑️ Cleaned up screenshot hash: ${urlHash}`);

    res.json({
      success: true,
      urlHash: urlHash,
      cleaned: cleaned,
      message: cleaned.length > 0 ? 'Screenshot cleaned successfully' : 'No screenshot found to clean'
    });

  } catch (err) {
    console.error(`❌ Screenshot cleanup failed for hash ${urlHash}:`, err);
    res.status(500).json({
      success: false,
      error: 'Screenshot cleanup failed',
      details: err.message
    });
  }
});

// Scheduled cleanup (files older than specified time)
app.get('/cleanup', (req, res) => {
  try {
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);  // Increased to 2 hours for testing
    let cleanedCount = 0;

    // Clean PDF uploads folder (2 hours)
    if (fs.existsSync('./uploads')) {
      fs.readdirSync('./uploads').forEach(file => {
        const filePath = path.join('./uploads', file);
        const stats = fs.statSync(filePath);
        if (stats.mtime.getTime() < twoHoursAgo) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      });
    }

    // Clean PDF output folders (2 hours)
    if (fs.existsSync('./output')) {
      fs.readdirSync('./output').forEach(folder => {
        const folderPath = path.join('./output', folder);
        if (fs.statSync(folderPath).isDirectory()) {
          const stats = fs.statSync(folderPath);
          if (stats.mtime.getTime() < twoHoursAgo) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            cleanedCount++;
          }
        }
      });
    }

    // Clean screenshot folders (2 hours)
    if (fs.existsSync('./screenshots')) {
      fs.readdirSync('./screenshots').forEach(folder => {
        const folderPath = path.join('./screenshots', folder);
        if (fs.statSync(folderPath).isDirectory()) {
          const stats = fs.statSync(folderPath);
          if (stats.mtime.getTime() < twoHoursAgo) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            cleanedCount++;
          }
        }
      });
    }

    console.log(`🗑️ Scheduled cleanup completed. Cleaned ${cleanedCount} items.`);

    res.json({
      success: true,
      cleanedCount: cleanedCount,
      message: `Cleaned ${cleanedCount} old files/folders`,
      cleanupPolicy: {
        pdfFiles: '2 hours',
        screenshots: '2 hours'
      }
    });

  } catch (err) {
    console.error("❌ Scheduled cleanup failed:", err);
    res.status(500).json({
      success: false,
      error: 'Scheduled cleanup failed',
      details: err.message
    });
  }
});

// ============== DEBUG ENDPOINT ==============

// Debug environment variables (remove in production)
app.get('/debug-env', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
      GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'SET' : 'NOT_SET',
      ENABLE_GCP_TEST: process.env.ENABLE_GCP_TEST,
      RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN,
    },
    hasCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    credentialsLength: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON.length : 0
  });
});

// ============== FORM STORAGE ENDPOINT ==============

// Store form structure in GCP
app.post('/store-form', async (req, res) => {
  try {
    const { formData, userId, metadata } = req.body;

    if (!formData) {
      return res.status(400).json({
        success: false,
        error: 'Form data is required'
      });
    }

    console.log('📝 Storing form structure in GCP...');
    console.log('🔍 Received metadata:', JSON.stringify(metadata, null, 2));
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Use the form ID from the form data, or generate a new one
    const formId = formData.id || formData.formId || `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store form structure
    console.log(`📝 Attempting to store form in Firestore: ${formId}`);
    console.log(`📝 Form data:`, JSON.stringify(formData, null, 2));
    
    const result = await gcpClient.storeFormStructure(
      formId,
      formData,
      userId || 'anonymous',
      {
        ...metadata,
        source: 'railway-backend',
        isHipaa: metadata?.isHipaa || false,
        isPublished: metadata?.isPublished || false,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip || req.connection.remoteAddress
      }
    );

    console.log(`✅ Form structure stored: ${formId}`);
    console.log(`✅ Storage result:`, JSON.stringify(result, null, 2));

    const responseData = {
      success: true,
      formId,
      userId: userId || 'anonymous',
      isAnonymous: !userId || userId === 'anonymous',
      isUpdate: metadata?.isEdit || false,
      isLLMUpdate: metadata?.isLLMUpdate || false,
      message: 'Form structure stored successfully',
      timestamp: new Date().toISOString()
    };
    
    console.log('🔍 Sending response:', JSON.stringify(responseData, null, 2));
    res.json(responseData);

  } catch (error) {
    console.error('❌ Form storage error:', error);
    res.status(500).json({
      success: false,
      error: 'Form storage failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== VIEW TRACKING ENDPOINT ==============

// Track form view (non-blocking, isolated from submissions)
app.post('/api/forms/:formId/view', async (req, res) => {
  try {
    const { formId } = req.params;
    const { sessionId, referrer, timestamp } = req.body;

    if (!formId || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID and session ID are required'
      });
    }

    console.log(`👁️ Tracking view for form: ${formId}, session: ${sessionId}`);

    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Check for existing view (deduplication)
    const existingView = await gcpClient.getViewBySession(formId, sessionId);
    if (existingView) {
      console.log(`✅ View already tracked for session: ${sessionId}`);
      return res.json({
        success: true,
        viewId: existingView.view_id,
        duplicate: true
      });
    }

    // Parse device info from user agent
    const UAParser = require('ua-parser-js');
    const parser = new UAParser(req.get('User-Agent'));
    const device = parser.getDevice();
    const browser = parser.getBrowser();
    const os = parser.getOS();

    let deviceType = 'desktop';
    if (device.type === 'mobile') deviceType = 'mobile';
    else if (device.type === 'tablet') deviceType = 'tablet';

    const deviceInfo = {
      deviceType,
      browser: browser.name && browser.version 
        ? `${browser.name} ${browser.version}` 
        : browser.name || 'Unknown',
      os: os.name && os.version 
        ? `${os.name} ${os.version}` 
        : os.name || 'Unknown'
    };

    // Get geolocation (non-blocking - if it fails, continue without geo data)
    let geoData = { city: null, region: null, country: null };
    try {
      const { getLocationFromIP } = require('./utils/geolocation');
      const ipAddress = req.ip || req.connection.remoteAddress;
      geoData = await getLocationFromIP(ipAddress);
    } catch (error) {
      console.warn('⚠️  Geolocation lookup failed (non-blocking):', error.message);
      // Continue without geo data
    }

    // Insert view into BigQuery
    const viewId = await gcpClient.insertFormView({
      form_id: formId,
      session_id: sessionId,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get('User-Agent'),
      referrer: referrer || null,
      device_type: deviceInfo.deviceType,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      country: geoData.country,
      city: geoData.city,
      region: geoData.region
    });

    res.json({
      success: true,
      viewId
    });

  } catch (error) {
    console.error('❌ View tracking error:', error);
    // Non-blocking - return success even if tracking fails
    res.json({
      success: false,
      error: 'View tracking failed (non-blocking)',
      details: error.message
    });
  }
});

// ============== FORM SUBMISSION ENDPOINT ==============

// Submit form data with GCP integration
app.post('/submit-form', async (req, res) => {
  try {
    const { formId, formData, userId, isHipaa, metadata } = req.body;

    if (!formId || !formData) {
      return res.status(400).json({
        success: false,
        error: 'Form ID and form data are required'
      });
    }

    console.log(`📤 Processing form submission: ${formId}`);
    console.log(`🛡️ HIPAA flag received: ${isHipaa} (type: ${typeof isHipaa})`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Generate submission ID
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Get client metadata
    const clientMetadata = {
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      ...metadata
    };

    let result;

    console.log(`🛡️ HIPAA check: isHipaa=${isHipaa}, will use HIPAA pipeline: ${!!isHipaa}`);

    if (isHipaa) {
      // Process as HIPAA-compliant submission
      console.log(`🛡️ Routing to HIPAA submission pipeline`);
      result = await gcpClient.processHipaaSubmission(
        submissionId,
        formId,
        formData,
        userId || 'anonymous',
        clientMetadata
      );
    } else {
      // Process as regular submission
      console.log(`📝 Routing to regular submission pipeline`);
      result = await gcpClient.storeFormSubmission(
        submissionId,
        formId,
        formData,
        userId || 'anonymous',
        clientMetadata
      );

      // Store signature images in GCS (skip PDF generation for now)
      await gcpClient.storeSignatureImages(submissionId, formId, formData, false);

      // Update form analytics (existing - submissions count)
      try {
        const analyticsResult = await gcpClient.updateFormAnalytics(formId, userId || 'anonymous');
        if (analyticsResult.success) {
          console.log(`✅ Analytics updated for form: ${formId}`);
        } else {
          console.warn(`⚠️ Analytics update failed for form ${formId}:`, analyticsResult.error);
        }
      } catch (analyticsError) {
        console.warn(`⚠️ Analytics update failed for form ${formId}:`, analyticsError.message);
        // Don't fail the form submission if analytics fails
      }
    }

    // ============================================================
    // NEW: Analytics Update (ISOLATED, NON-BLOCKING)
    // ============================================================
    // Analytics update happens AFTER submission succeeds
    // Wrapped in try-catch - failures don't affect submission
    updateAnalyticsAsync(formId, submissionId, clientMetadata, isHipaa).catch(err => {
      console.warn(`⚠️ Analytics update failed (non-blocking) for ${formId}:`, err.message);
      // Don't throw - submission already succeeded
    });

    console.log(`✅ Form submission processed: ${submissionId}`);

    res.json({
      success: true,
      submissionId,
      formId,
      message: 'Form submitted successfully',
      isHipaa,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Form submission failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================================
// ISOLATED Analytics Update Function
// ============================================================
async function updateAnalyticsAsync(formId, submissionId, metadata, isHipaa) {
  try {
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Parse device info from user_agent
    const UAParser = require('ua-parser-js');
    const parser = new UAParser(metadata.userAgent || '');
    const device = parser.getDevice();

    let deviceType = 'desktop';
    if (device.type === 'mobile') deviceType = 'mobile';
    else if (device.type === 'tablet') deviceType = 'tablet';

    // Update form_analytics table with device info and completion time
    await gcpClient.updateFormAnalyticsWithDevice(
      formId,
      {
        deviceType,
        completionTime: metadata.completionTime || null,
        // Note: No distinction between HIPAA and regular in analytics
      }
    );

    console.log(`✅ Analytics updated for form: ${formId}`);
  } catch (error) {
    // Analytics errors are logged but don't propagate
    // Error is caught by caller's .catch() block - don't throw
    console.error(`❌ Analytics update error for ${formId}:`, error);
    // Re-throw to be caught by caller's .catch() - this is intentional
    throw error;
  }
}

// ============== FORM RETRIEVAL ENDPOINT ==============

// Get form structure from GCP
app.get('/form/:formId', async (req, res) => {
  try {
    const { formId } = req.params;

    console.log(`📋 Fetching form: ${formId}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Get form data from Firestore with fresh read to avoid cache issues after updates
    console.log(`📋 Attempting to retrieve form from Firestore: ${formId}`);
    
    // Add small delay to allow Firestore to propagate changes
    await new Promise(resolve => setTimeout(resolve, 1000));
    const formData = await gcpClient.getFormStructure(formId, true);

    console.log(`📋 Form retrieval result:`, formData ? 'Found' : 'Not found');
    if (formData) {
      console.log(`📋 Form data keys:`, Object.keys(formData));
    }

    if (!formData) {
      return res.status(404).json({
        success: false,
        error: 'Form not found',
        timestamp: new Date().toISOString()
      });
    }

    // Enrich payment fields with stored configuration (amount, currency, publishable key)
    const paymentWarnings = [];
    if (formData?.structure?.fields && Array.isArray(formData.structure.fields)) {
      const paymentFields = await gcpClient.getPaymentFields(formId);
      if (paymentFields.length > 0) {
        const paymentFieldMap = paymentFields.reduce((acc, field) => {
          acc[field.field_id] = field;
          return acc;
        }, {});

        formData.structure.fields = formData.structure.fields.map((field) => {
          if (field.type !== 'payment') {
            return field;
          }

          const storedConfig = paymentFieldMap[field.id];
          let paymentError;
          if (!storedConfig) {
            paymentError = 'Payment configuration missing. Please reconnect this Stripe account.';
          } else if (!storedConfig.publishable_key) {
            paymentError = 'Stripe account must be reconnected to refresh publishable keys.';
          }

          if (paymentError) {
            const warning = {
              fieldId: field.id,
              reason: !storedConfig ? 'missing_payment_configuration' : 'missing_publishable_key'
            };
            paymentWarnings.push(warning);
            console.warn(`⚠️ Payment field warning for form ${formId}:`, warning);
          }

          return {
            ...field,
            amount: storedConfig && typeof storedConfig.amount === 'number'
              ? storedConfig.amount / 100
              : field.amount,
            currency: field.currency || storedConfig?.currency || 'usd',
            description: field.description ?? storedConfig?.description ?? '',
            productName: field.productName ?? storedConfig?.product_name ?? '',
            stripeAccountId: storedConfig?.stripe_account_id,
            publishableKey: storedConfig?.publishable_key || null,
            paymentError
          };
        });
      }
    }

    // Prevent any intermediary/proxy/browser caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.json({
      success: true,
      form: formData,
      paymentWarnings,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANALYTICS ENDPOINT ==============

// Get form analytics from GCP
app.get('/analytics/:formId', async (req, res) => {
  try {
    const { formId } = req.params;

    console.log(`📊 Fetching analytics for form: ${formId}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Get analytics data from BigQuery
    const analytics = await gcpClient.getFormAnalytics(formId);

    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Analytics not found for this form',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANALYTICS OVERVIEW ENDPOINT ==============

// Get analytics overview for a form (with views, submissions, completion rate)
app.get('/analytics/forms/:formId/overview',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
    // Handle dateRange with or without 'd' suffix (e.g., "30d" or "30")
    const dateRangeParam = req.query.dateRange || '30';
    const dateRange = parseInt(dateRangeParam.toString().replace(/d$/, '')) || 30; // Default 30 days

    console.log(`📊 Fetching analytics overview for form: ${formId}, dateRange: ${dateRange}d`);

    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Get form analytics from BigQuery
    const analytics = await gcpClient.getFormAnalytics(formId);

    if (!analytics) {
      return res.json({
        success: true,
        totalViews: 0,
        totalSubmissions: 0,
        completionRate: 0,
        lastSubmission: null,
        trends: {
          views: [],
          submissions: []
        },
        deviceBreakdown: {
          desktop: { views: 0 },
          mobile: { views: 0 },
          tablet: { views: 0 },
          other: { views: 0 }
        },
        geoBreakdown: []
      });
    }

    // Get view trends from form_views table
    // Filter: from N days ago to end of today (exclude future dates)
    const viewsQuery = `
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as count
      FROM \`${gcpClient.projectId}.form_submissions.form_views\`
      WHERE form_id = @formId
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
        AND timestamp <= CURRENT_TIMESTAMP()
      GROUP BY date
      ORDER BY date ASC
    `;

    const [viewsRows] = await gcpClient.bigquery.query({
      query: viewsQuery,
      params: { formId, days: dateRange }
    });

    // Get device breakdown from form_views table (same date range window)
    // NOTE: This is views-only for now; submissions remain Firestore-only.
    let deviceRows = [];
    try {
      const deviceQuery = `
        SELECT 
          COALESCE(device_type, 'unknown') as device_type,
          COUNT(*) as views
        FROM \`${gcpClient.projectId}.form_submissions.form_views\`
        WHERE form_id = @formId
          AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
          AND timestamp <= CURRENT_TIMESTAMP()
        GROUP BY device_type
      `;

      [deviceRows] = await gcpClient.bigquery.query({
        query: deviceQuery,
        params: { formId, days: dateRange }
      });
    } catch (error) {
      console.warn('⚠️ Error querying device breakdown:', error.message);
      // Continue with empty deviceRows - device breakdown failure shouldn't break the endpoint
    }

    // Get geographic breakdown from form_views table (same date range window)
    // Group by city/region combination for better granularity
    let geoRows = [];
    try {
      const geoQuery = `
        SELECT 
          COALESCE(city, 'Unknown') as city,
          COALESCE(region, 'Unknown') as region,
          COALESCE(country, 'Unknown') as country,
          COUNT(*) as views
        FROM \`${gcpClient.projectId}.form_submissions.form_views\`
        WHERE form_id = @formId
          AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
          AND timestamp <= CURRENT_TIMESTAMP()
          AND (city IS NOT NULL OR region IS NOT NULL OR country IS NOT NULL)
        GROUP BY city, region, country
        ORDER BY views DESC
        LIMIT 10
      `;

      [geoRows] = await gcpClient.bigquery.query({
        query: geoQuery,
        params: { formId, days: dateRange }
      });
    } catch (error) {
      console.warn('⚠️ Error querying geographic breakdown:', error.message);
      // Continue with empty geoRows - geo breakdown failure shouldn't break the endpoint
    }

    // Get submission trends from Firestore (grouped by date)
    // Calculate date range: from N days ago to end of today
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - dateRange);
    dateFrom.setHours(0, 0, 0, 0); // Start of day
    
    const dateTo = new Date();
    dateTo.setHours(23, 59, 59, 999); // End of today (exclude future dates)
    
    // Convert to Firestore Timestamp for proper comparison
    const { Firestore } = require('@google-cloud/firestore');
    const dateFromTimestamp = Firestore.Timestamp.fromDate(dateFrom);
    const dateToTimestamp = Firestore.Timestamp.fromDate(dateTo);
    
    console.log(`📅 Filtering submissions from: ${dateFrom.toISOString()} to ${dateTo.toISOString()} (${dateRange} days)`);
    
    let submissionsByDate = {};
    try {
      // Query without orderBy to avoid index requirement, we'll sort in memory
      // Filter: timestamp >= dateFrom AND timestamp <= dateTo (exclude future dates)
      const submissionsSnapshot = await gcpClient
        .collection('submissions')
        .where('form_id', '==', formId)
        .where('timestamp', '>=', dateFromTimestamp)
        .where('timestamp', '<=', dateToTimestamp)
        .get();
      
      console.log(`📊 Found ${submissionsSnapshot.docs.length} submissions within date range`);

      // Group submissions by date
      submissionsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.timestamp) {
          const date = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
          const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
          
          // Double-check: only include dates within range (defensive check)
          const dateOnly = new Date(dateKey + 'T00:00:00.000Z');
          const dateFromOnly = new Date(dateFrom.toISOString().split('T')[0] + 'T00:00:00.000Z');
          const dateToOnly = new Date(dateTo.toISOString().split('T')[0] + 'T00:00:00.000Z');
          
          if (dateOnly >= dateFromOnly && dateOnly <= dateToOnly) {
            submissionsByDate[dateKey] = (submissionsByDate[dateKey] || 0) + 1;
          } else {
            console.log(`⚠️ Skipping submission ${data.submission_id || doc.id} with date ${dateKey} (outside range ${dateFromOnly.toISOString().split('T')[0]} to ${dateToOnly.toISOString().split('T')[0]})`);
          }
        }
      });
      
      console.log(`📊 Grouped ${submissionsSnapshot.docs.length} submissions by date:`, Object.keys(submissionsByDate).length, 'dates');
      console.log(`📅 Date keys:`, Object.keys(submissionsByDate).sort().join(', '));
    } catch (error) {
      console.warn('⚠️ Error querying Firestore for submissions:', error.message);
      // Continue with empty submissionsByDate
    }

    // Merge views and submissions by date
    const viewsMap = new Map();
    viewsRows.forEach(row => {
      try {
        // Handle BigQuery DATE() return format - can be string, Date, or {value: Date/string}
        let dateValue = row.date;
        
        // Extract value if wrapped in object
        if (dateValue && typeof dateValue === 'object' && 'value' in dateValue) {
          dateValue = dateValue.value;
        }
        
        // Convert to date string (YYYY-MM-DD)
        let dateKey;
        if (dateValue instanceof Date) {
          dateKey = dateValue.toISOString().split('T')[0];
        } else if (typeof dateValue === 'string') {
          // BigQuery DATE() returns YYYY-MM-DD string format
          dateKey = dateValue.split('T')[0].split(' ')[0]; // Handle both ISO and date-only strings
        } else if (dateValue) {
          // Fallback: try to parse as date
          const parsed = new Date(dateValue);
          if (!isNaN(parsed.getTime())) {
            dateKey = parsed.toISOString().split('T')[0];
          } else {
            console.warn(`⚠️ Could not parse date value:`, dateValue);
            return; // Skip this row
          }
        } else {
          console.warn(`⚠️ Missing date value in row:`, row);
          return; // Skip this row
        }
        
        viewsMap.set(dateKey, parseInt(row.count) || 0);
      } catch (error) {
        console.warn(`⚠️ Error processing view row:`, error.message, row);
        // Continue with next row
      }
    });

    // Get all unique dates from both views and submissions
    const allDates = new Set();
    viewsMap.forEach((_, date) => allDates.add(date));
    Object.keys(submissionsByDate).forEach(date => allDates.add(date));

    // Sort dates and create trends array
    const sortedDates = Array.from(allDates).sort();
    const trends = {
      views: sortedDates.map(date => ({
        date,
        count: viewsMap.get(date) || 0
      })),
      submissions: sortedDates.map(date => ({
        date,
        count: submissionsByDate[date] || 0
      }))
    };

    // Build device breakdown object from deviceRows
    // We keep this focused on views by device over the selected window.
    const deviceCounts = {
      desktop: 0,
      mobile: 0,
      tablet: 0,
      other: 0
    };

    deviceRows.forEach(row => {
      const rawType = (row.device_type || '').toString().toLowerCase();
      const views = parseInt(row.views, 10) || 0;

      if (!rawType) {
        deviceCounts.other += views;
        return;
      }

      if (rawType.includes('desktop')) {
        deviceCounts.desktop += views;
      } else if (rawType.includes('mobile')) {
        deviceCounts.mobile += views;
      } else if (rawType.includes('tablet') || rawType.includes('ipad')) {
        deviceCounts.tablet += views;
      } else {
        deviceCounts.other += views;
      }
    });

    const deviceBreakdown = {
      desktop: { views: deviceCounts.desktop },
      mobile: { views: deviceCounts.mobile },
      tablet: { views: deviceCounts.tablet },
      other: { views: deviceCounts.other }
    };

    // Build geographic breakdown array (top locations by views)
    const geoBreakdown = geoRows.map(row => ({
      city: row.city !== 'Unknown' ? row.city : null,
      region: row.region !== 'Unknown' ? row.region : null,
      country: row.country !== 'Unknown' ? row.country : null,
      views: parseInt(row.views, 10) || 0
    })).filter(loc => loc.city || loc.region || loc.country); // Filter out completely unknown locations
    
    // Calculate totals from filtered trends data (not from aggregate table)
    // IMPORTANT: These MUST match the sum of trends arrays
    const totalViews = trends.views.reduce((sum, v) => sum + (v.count || 0), 0);
    const totalSubmissions = trends.submissions.reduce((sum, s) => sum + (s.count || 0), 0);
    
    // Debug logging
    console.log(`📊 Trends array details:`);
    console.log(`   Views:`, JSON.stringify(trends.views, null, 2));
    console.log(`   Submissions:`, JSON.stringify(trends.submissions, null, 2));
    console.log(`📊 Trends summary: ${sortedDates.length} dates, ${totalViews} total views, ${totalSubmissions} total submissions`);
    console.log(`📊 ViewsMap size: ${viewsMap.size}, SubmissionsByDate keys: ${Object.keys(submissionsByDate).length}`);

    // Calculate completion rate from filtered data
    const completionRate = totalViews > 0 
      ? Math.min((totalSubmissions / totalViews) * 100, 100) // Cap at 100%
      : 0;

    // Get last submission date from filtered trends (most recent date with submissions)
    let lastSubmission = null;
    const submissionDates = trends.submissions
      .filter(s => s.count > 0)
      .map(s => s.date)
      .sort()
      .reverse();
    if (submissionDates.length > 0) {
      // Use the most recent date that has submissions
      lastSubmission = submissionDates[0];
    } else if (analytics.last_submission) {
      // Fallback to aggregate table if no filtered submissions
      lastSubmission = analytics.last_submission.value 
        ? analytics.last_submission.value 
        : analytics.last_submission;
    }

    res.json({
      success: true,
      totalViews,
      totalSubmissions,
      completionRate: Math.round(completionRate * 100) / 100, // Round to 2 decimal places
      lastSubmission,
      trends,
      deviceBreakdown,
      geoBreakdown
    });

  } catch (error) {
    console.error('❌ Analytics overview fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics overview',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== FIELD ANALYTICS ENDPOINT ==============

// Get field-level analytics for a form
app.get('/analytics/forms/:formId/fields',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
    
    // Handle dateRange with or without 'd' suffix (e.g., "30d" or "30")
    const dateRangeParam = req.query.dateRange || '30';
    const dateRange = parseInt(dateRangeParam.toString().replace(/d$/, '')) || 30; // Default 30 days
    
    console.log(`📊 Fetching field analytics for form: ${formId}, dateRange: ${dateRange}d`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Fetch form structure to get field definitions
    const formDoc = await gcpClient.getFormStructure(formId, true);
    if (!formDoc) {
      return res.status(404).json({
        success: false,
        error: 'Form not found',
        formId,
        timestamp: new Date().toISOString()
      });
    }
    
    const fields = formDoc.structure?.fields || formDoc.fields || [];
    
    // Calculate date range using UTC for consistency with Firestore timestamps
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - dateRange);
    startDate.setUTCHours(0, 0, 0, 0); // Start of day (UTC)
    endDate.setUTCHours(23, 59, 59, 999); // End of today (UTC)
    
    if (fields.length === 0) {
      return res.json({
        success: true,
        formId,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        fields: [],
        message: 'Form has no fields'
      });
    }
    
    console.log(`📅 Field analytics date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get submissions with date filtering
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
    
    const totalSubmissionsInRange = submissions.length;
    console.log(`📊 Found ${totalSubmissionsInRange} submissions in date range`);
    console.log(`📊 Form has ${fields.length} fields:`, fields.map(f => ({ id: f.id, label: f.label, type: f.type })));
    
    // Debug: Check submission data structure
    if (submissions.length > 0) {
      const sampleSubmission = submissions[0];
      if (sampleSubmission && sampleSubmission.submission_data) {
        console.log(`📊 Sample submission field IDs:`, Object.keys(sampleSubmission.submission_data));
      }
    }
    
    // Import field analytics computation
    const { computeFieldAnalytics } = require('./utils/field-analytics');
    
    // Timeout protection for large datasets (10 seconds)
    const TIMEOUT_MS = 10000;
    const analyticsPromise = computeFieldAnalytics(fields, submissions, totalSubmissionsInRange);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Analytics computation timeout')), TIMEOUT_MS)
    );
    
    let fieldAnalytics;
    let fieldErrors = [];
    try {
      const result = await Promise.race([analyticsPromise, timeoutPromise]);
      fieldAnalytics = result.fields || [];
      fieldErrors = result.errors || [];
    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn(`⚠️ Field analytics timeout for form ${formId}`);
        return res.status(500).json({
          success: false,
          error: 'Analytics computation timeout',
          message: 'Please try a shorter date range',
          formId,
          timestamp: new Date().toISOString()
        });
      }
      throw error;
    }
    
    // Order fields to match form structure order
    const fieldOrderMap = new Map();
    fields.forEach((field, index) => {
      if (field.id) {
        fieldOrderMap.set(field.id, index);
      }
    });
    
    fieldAnalytics.sort((a, b) => {
      const orderA = fieldOrderMap.get(a.fieldId) ?? Infinity;
      const orderB = fieldOrderMap.get(b.fieldId) ?? Infinity;
      return orderA - orderB;
    });
    
    console.log(`📊 Field analytics computed: ${fieldAnalytics.length} fields, ${fieldErrors.length} errors`);
    console.log(`📊 Field IDs in results:`, fieldAnalytics.map(f => f.fieldId));
    
    // Return response with graceful degradation (partial results if some fields failed)
    if (fieldAnalytics.length === 0 && fieldErrors.length > 0) {
      // All fields failed
      return res.status(500).json({
        success: false,
        error: 'Failed to compute field analytics',
        errors: fieldErrors,
        formId,
        timestamp: new Date().toISOString()
      });
    }
    
    // Partial or complete success
    const response = {
      success: true,
      formId,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      fields: fieldAnalytics
    };
    
    // Include errors if any (for graceful degradation)
    if (fieldErrors.length > 0) {
      response.errors = fieldErrors;
    }
    
    console.log(`✅ Field analytics computed: ${fieldAnalytics.length} fields, ${fieldErrors.length} errors`);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Field analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch field analytics',
      details: error.message,
      formId: req.params.formId,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANALYTICS PREFERENCES ENDPOINT ==============

// Helper function to extract userId from JWT token
function getUserIdFromRequest(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-for-oauth');
    // Check both userId and id fields (verify actual JWT structure in codebase)
    return decoded.userId || decoded.id || null;
  } catch (error) {
    // Token invalid or expired
    return null;
  }
}

// Get user's analytics preferences for a form
app.get('/analytics/forms/:formId/preferences',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id; // From middleware (defensive check)
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    
    const docId = `${userId}_${formId}`;
    const doc = await gcpClient.collection('analytics_preferences').doc(docId).get();
    
    if (!doc.exists) {
      // Return empty preferences if document doesn't exist yet
      return res.json({ starredFields: [], expandedFields: [] });
    }
    
    // 🔍 INSPECT ACTUAL DOCUMENT DATA STRUCTURE
    const data = doc.data();
    console.log('🔍 ACTUAL DOCUMENT DATA:', JSON.stringify(data, null, 2));
    console.log('🔍 AVAILABLE KEYS:', Object.keys(data || {}));
    
    // Handle both camelCase and snake_case field names
    const starredFields = data.starredFields || data.starred_fields || [];
    const expandedFields = data.expandedFields || data.expanded_fields || [];
    
    res.json({
      starredFields: Array.isArray(starredFields) ? starredFields : [],
      expandedFields: Array.isArray(expandedFields) ? expandedFields : []
    });
  } catch (error) {
    console.error('Error fetching analytics preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user's analytics preferences for a form
app.post('/analytics/forms/:formId/preferences',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      // 🔍 INSPECT ACTUAL REQUEST BODY STRUCTURE
      console.log('🔍 ACTUAL REQUEST BODY:', JSON.stringify(req.body, null, 2));
      console.log('🔍 AVAILABLE KEYS:', Object.keys(req.body || {}));
      
      const { formId } = req.params;
      const userId = req.user.userId; // From middleware
      
      // Validate and extract fields from request body
      // Check actual field names (starredFields vs starred_fields, etc.)
      const starredFields = req.body.starredFields || req.body.starred_fields;
      const expandedFields = req.body.expandedFields || req.body.expanded_fields;
      
      // Validate field types if provided
      if (starredFields !== undefined && !Array.isArray(starredFields)) {
        return res.status(400).json({ error: 'starredFields must be an array' });
      }
      if (expandedFields !== undefined && !Array.isArray(expandedFields)) {
        return res.status(400).json({ error: 'expandedFields must be an array' });
      }
      
      const docId = `${userId}_${formId}`;
      const updateData = {
        userId,
        formId,
        updatedAt: new Date().toISOString()
      };
      
      if (starredFields !== undefined) updateData.starredFields = starredFields;
      if (expandedFields !== undefined) updateData.expandedFields = expandedFields;
      
      await gcpClient.collection('analytics_preferences')
        .doc(docId)
        .set(updateData, { merge: true });
      
      res.json({ success: true });
    } catch (error) {
    console.error('Error saving analytics preferences:', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// ============== CROSS-FIELD ANALYTICS ENDPOINTS ==============

// Get default cross-field comparisons for a form
app.get('/analytics/forms/:formId/cross-field/defaults',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
    const dateRangeParam = req.query.dateRange || '30';
    const dateRange = parseInt(dateRangeParam.toString().replace(/d$/, '')) || 30;

    console.log(`📊 Fetching default cross-field comparisons for form: ${formId}, dateRange: ${dateRange}d`);

    // Fetch form structure
    const formDoc = await gcpClient.getFormStructure(formId, true);
    if (!formDoc) {
      return res.status(404).json({
        success: false,
        error: 'Form not found',
        formId
      });
    }

    const fields = formDoc.structure?.fields || formDoc.fields || [];
    if (fields.length < 2) {
      return res.json({
        success: true,
        comparisons: [],
        message: 'Form needs at least 2 fields for cross-field analysis'
      });
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - dateRange);
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    // Get submissions
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    // Auto-detect default comparisons
    const { detectDefaultComparisons } = require('./utils/cross-field-analytics');
    const defaultComparisons = detectDefaultComparisons(fields, submissions);

    // Calculate analysis for each comparison with timeout protection
    const { calculateCrossFieldAnalysis } = require('./utils/cross-field-analytics');
    const TIMEOUT_MS = 10000; // 10 second timeout
    
    const comparisonsPromises = defaultComparisons.map(async comp => {
      const analysisPromise = new Promise((resolve) => {
        const analysis = calculateCrossFieldAnalysis(submissions, comp.field1, comp.field2);
        resolve(analysis);
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Analysis timeout')), TIMEOUT_MS)
      );
      
      try {
        const analysis = await Promise.race([analysisPromise, timeoutPromise]);
        return {
          comparisonId: comp.comparisonId,
          field1: {
            id: comp.field1.id,
            label: comp.field1.label
          },
          field2: {
            id: comp.field2.id,
            label: comp.field2.label
          },
          question: comp.question,
          answer: analysis.answer,
          bigNumber: analysis.bigNumber,
          strength: analysis.strength,
          chartType: analysis.chartType,
          chartData: analysis.chartData
        };
      } catch (error) {
        // Return error comparison if timeout
        return {
          comparisonId: comp.comparisonId,
          field1: { id: comp.field1.id, label: comp.field1.label },
          field2: { id: comp.field2.id, label: comp.field2.label },
          question: comp.question,
          answer: 'Analysis took too long - please try a shorter date range',
          bigNumber: null,
          strength: 'no clear pattern',
          chartType: 'bars',
          chartData: []
        };
      }
    });
    
    const comparisonsWithData = await Promise.all(comparisonsPromises);

    res.json({
      success: true,
      comparisons: comparisonsWithData,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching default comparisons:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch default comparisons',
      details: error.message
    });
  }
});

// Analyze two specific fields
app.get('/analytics/forms/:formId/cross-field/analyze',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
    const { fieldId1, fieldId2 } = req.query;
    const dateRangeParam = req.query.dateRange || '30';
    const dateRange = parseInt(dateRangeParam.toString().replace(/d$/, '')) || 30;

    if (!fieldId1 || !fieldId2) {
      return res.status(400).json({
        success: false,
        error: 'Both fieldId1 and fieldId2 are required'
      });
    }

    // Fetch form structure
    const formDoc = await gcpClient.getFormStructure(formId, true);
    if (!formDoc) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    const fields = formDoc.structure?.fields || [];
    const field1 = fields.find(f => f.id === fieldId1);
    const field2 = fields.find(f => f.id === fieldId2);

    if (!field1 || !field2) {
      return res.status(404).json({
        success: false,
        error: 'One or both fields not found'
      });
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - dateRange);
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    // Get submissions
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    // Calculate analysis
    const { calculateCrossFieldAnalysis } = require('./utils/cross-field-analytics');
    const analysis = calculateCrossFieldAnalysis(submissions, field1, field2);

    res.json({
      success: true,
      field1: {
        id: field1.id,
        label: field1.label
      },
      field2: {
        id: field2.id,
        label: field2.label
      },
      question: analysis.question,
      answer: analysis.answer,
      bigNumber: analysis.bigNumber,
      strength: analysis.strength,
      chartType: analysis.chartType,
      chartData: analysis.chartData,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });
  } catch (error) {
    console.error('Error analyzing cross-field:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze fields',
      details: error.message
    });
  }
});

// Get user's favorited comparisons
app.get('/analytics/forms/:formId/cross-field/favorites',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id; // From middleware (defensive check)
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

    const docId = `${userId}_${formId}`;
    const doc = await gcpClient.collection('analytics_preferences').doc(docId).get();

    if (!doc.exists) {
      return res.json({ favoritedComparisons: [] });
    }

    const data = doc.data();
    res.json({
      favoritedComparisons: data.favoritedComparisons || []
    });
  } catch (error) {
    console.error('Error fetching comparison favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// Update user's favorited comparisons
app.post('/analytics/forms/:formId/cross-field/favorites',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id; // From middleware (defensive check)
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { comparisonId, isFavorite } = req.body;

    if (!comparisonId || typeof isFavorite !== 'boolean') {
      return res.status(400).json({
        error: 'comparisonId and isFavorite (boolean) are required'
      });
    }

    const docId = `${userId}_${formId}`;
    const doc = await gcpClient.collection('analytics_preferences').doc(docId).get();

    let favoritedComparisons = [];
    if (doc.exists) {
      const data = doc.data();
      favoritedComparisons = data.favoritedComparisons || [];
    }

    // Add or remove comparison ID
    if (isFavorite) {
      if (!favoritedComparisons.includes(comparisonId)) {
        favoritedComparisons.push(comparisonId);
      }
    } else {
      favoritedComparisons = favoritedComparisons.filter(id => id !== comparisonId);
    }

    // Update document
    await gcpClient.collection('analytics_preferences')
      .doc(docId)
      .set({
        userId,
        formId,
        favoritedComparisons,
        updatedAt: new Date().toISOString()
      }, { merge: true });

    res.json({
      success: true,
      favoritedComparisons
    });
  } catch (error) {
    console.error('Error updating comparison favorites:', error);
    res.status(500).json({ error: 'Failed to update favorites' });
  }
});

// ============== CUSTOM ANALYTICS ENDPOINTS ==============

// Analyze custom fields with template
app.post('/api/analytics/forms/:formId/custom/analyze',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id; // From middleware (defensive check)
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    
    // 🔍 INSPECT ACTUAL REQUEST BODY (following repo rule: never assume field names)
    console.log('🔍 ANALYZE - REQUEST BODY:', JSON.stringify(req.body, null, 2));
    console.log('🔍 ANALYZE - AVAILABLE KEYS:', Object.keys(req.body));
    
    // Handle both snake_case and camelCase field names
    const template_type = req.body.template_type || req.body.templateType;
    const primary_field_id = req.body.primary_field_id || req.body.primaryFieldId;
    const secondary_field_id = req.body.secondary_field_id || req.body.secondaryFieldId;
    const filters = req.body.filters || [];
    const aggregation = req.body.aggregation || 'mean';
    const time_granularity = req.body.time_granularity || req.body.timeGranularity || null;
    const date_range = req.body.date_range || req.body.dateRange;
    
    console.log(`📊 Custom analysis request: formId=${formId}, template=${template_type}, userId=${userId}`);
    
    // Validate required fields
    if (!template_type || !primary_field_id || !secondary_field_id) {
      return res.status(400).json({
        success: false,
        error: 'template_type, primary_field_id, and secondary_field_id are required'
      });
    }
    
    // Validate aggregation parameter
    const validAggregations = ['mean', 'median', 'p90'];
    if (aggregation && !validAggregations.includes(aggregation)) {
      return res.status(400).json({
        success: false,
        error: `Invalid aggregation. Must be one of: ${validAggregations.join(', ')}`,
        received: aggregation
      });
    }
    
    // Get form structure
    const formDoc = await gcpClient.getFormStructure(formId, true);
    if (!formDoc) {
      return res.status(404).json({
        success: false,
        error: 'Form not found',
        formId
      });
    }
    
    const fields = formDoc.structure?.fields || formDoc.fields || [];
    
    // Find selected fields
    const primaryField = fields.find(f => f.id === primary_field_id);
    const secondaryField = fields.find(f => f.id === secondary_field_id);
    
    if (!primaryField || !secondaryField) {
      return res.status(400).json({
        success: false,
        error: 'Field not found',
        missing_primary: !primaryField,
        missing_secondary: !secondaryField
      });
    }
    
    // Validate compatibility
    const { validateFieldCompatibility } = require('./utils/custom-analytics');
    const compatible = validateFieldCompatibility(template_type, primaryField, secondaryField);
    
    if (!compatible) {
      return res.status(400).json({
        success: false,
        error: 'Field types not compatible with selected template',
        template_type,
        primary_type: primaryField.type,
        secondary_type: secondaryField.type
      });
    }
    
    // Calculate date range (default to 30 days if not provided)
    let startDate, endDate;
    if (date_range && date_range.start && date_range.end) {
      startDate = new Date(date_range.start);
      endDate = new Date(date_range.end);
    } else {
      endDate = new Date();
      startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - 30);
    }
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);
    
    console.log(`📅 DATE RANGE: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Load submissions (from Firestore/GCS - automatically handles HIPAA)
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
    
    console.log(`📊 LOADED ${submissions.length} submissions after date filtering`);
    if (submissions.length > 0) {
      const firstSub = submissions[0];
      const lastSub = submissions[submissions.length - 1];
      const firstTimestamp = firstSub.timestamp || firstSub.created_at;
      const lastTimestamp = lastSub.timestamp || lastSub.created_at;
      console.log(`📅 First submission timestamp: ${JSON.stringify(firstTimestamp)}`);
      console.log(`📅 Last submission timestamp: ${JSON.stringify(lastTimestamp)}`);
    }
    
    // Performance: Dataset size limits
    const MAX_SUBMISSIONS_LIMIT = 10000;
    const MAX_SUBMISSIONS_WARNING = 5000;
    
    if (submissions.length > MAX_SUBMISSIONS_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `Too many submissions (${submissions.length}). Reduce date range to analyze.`,
        submission_count: submissions.length,
        max_allowed: MAX_SUBMISSIONS_LIMIT
      });
    }
    
    if (submissions.length > MAX_SUBMISSIONS_WARNING) {
      console.warn(`⚠️ Large dataset: ${submissions.length} submissions for custom analysis`);
    }
    
    // Compute analysis with timeout
    const { computeCustomAnalysis } = require('./utils/custom-analytics');
    const TIMEOUT_MS = 30000; // 30 second timeout
    
    const analysisPromise = computeCustomAnalysis(
      submissions,
      template_type,
      primaryField,
      secondaryField,
      { filters, aggregation, time_granularity }
    );
    
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Analysis computation timeout')), TIMEOUT_MS)
    );
    
    let result;
    try {
      result = await Promise.race([analysisPromise, timeoutPromise]);
    } catch (error) {
      if (error.message === 'Analysis computation timeout') {
        return res.status(408).json({
          success: false,
          error: 'Analysis is taking too long. Try reducing the date range or simplifying filters.',
          timeout: true
        });
      }
      throw error;
    }
    
    // Check for errors in result
    if (result.error) {
      console.error(`❌ ANALYSIS ERROR: ${result.error}, sampleSize=${result.sampleSize}`);
      return res.status(400).json({
        success: false,
        error: result.error,
        sampleSize: result.sampleSize
      });
    }
    
    console.log(`✅ ANALYSIS SUCCESS: Returning result with ${result.chartData?.length || 0} chart points, sampleSize=${result.sampleSize}`);
    
    res.json({
      success: true,
      analysis: {
        template_type,
        selected_fields: {
          primary: { 
            id: primaryField.id, 
            label: primaryField.label, 
            type: primaryField.type 
          },
          secondary: { 
            id: secondaryField.id, 
            label: secondaryField.label, 
            type: secondaryField.type 
          }
        },
        bigNumber: result.bigNumber,
        chartType: result.chartType,
        chartData: result.chartData,
        sampleSize: result.sampleSize,
        strength: result.strength
      },
      submission_count: submissions.length,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });
  } catch (error) {
    console.error('Custom analysis error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to compute analysis'
    });
  }
});

// Save custom analysis
app.post('/api/analytics/forms/:formId/custom/saved',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id; // From middleware (defensive check)
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    
    // 🔍 INSPECT ACTUAL REQUEST BODY (following repo rule: never assume field names)
    console.log('🔍 SAVE - REQUEST BODY:', JSON.stringify(req.body, null, 2));
    console.log('🔍 SAVE - AVAILABLE KEYS:', Object.keys(req.body));
    
    // Handle both snake_case and camelCase field names
    const analysis_id = req.body.analysis_id || req.body.analysisId;
    const template_type = req.body.template_type || req.body.templateType;
    const selected_fields = req.body.selected_fields || req.body.selectedFields;
    const filters = req.body.filters || [];
    const aggregation = req.body.aggregation || 'mean';
    const time_granularity = req.body.time_granularity || req.body.timeGranularity || null;
    const name = req.body.name;
    const pinned = req.body.pinned || false;
    const generated_insights = req.body.generated_insights || req.body.generatedInsights;
    const chart_config = req.body.chart_config || req.body.chartConfig;
    const date_range = req.body.date_range || req.body.dateRange;
    
    // Validate required fields
    if (!template_type || !selected_fields || !name) {
      return res.status(400).json({
        success: false,
        error: 'template_type, selected_fields, and name are required'
      });
    }
    
    // Check analysis limit (10 per form)
    const existingSnapshot = await gcpClient.collection('custom_analyses')
      .where('form_id', '==', formId)
      .get();
    
    // If updating existing, don't count it
    const existingCount = analysis_id 
      ? existingSnapshot.docs.filter(doc => doc.id !== analysis_id).length
      : existingSnapshot.docs.length;
    
    if (existingCount >= 10) {
      return res.status(400).json({
        success: false,
        error: 'Analysis limit reached. Maximum 10 custom analyses per form. Delete an existing analysis to create a new one.',
        current_count: existingCount,
        limit: 10
      });
    }
    
    const analysisId = analysis_id || `custom_${formId}_${Date.now()}`;
    
    // Get current submission count for cache freshness tracking
    // Use date_range from request if provided, otherwise default to 30 days
    let startDate, endDate;
    if (date_range && date_range.start && date_range.end) {
      startDate = new Date(date_range.start);
      endDate = new Date(date_range.end);
    } else {
      endDate = new Date();
      startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - 30);
    }
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);
    
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
    
    const analysisDoc = {
      analysis_id: analysisId,
      form_id: formId,
      user_id: userId,
      created_by: userId,
      created_at: Firestore.FieldValue.serverTimestamp(),
      updated_at: Firestore.FieldValue.serverTimestamp(),
      template_type,
      selected_fields,
      filters,
      aggregation,
      time_granularity,
      name: name.substring(0, 50), // Max 50 characters
      pinned: Boolean(pinned),
      order: pinned ? 0 : existingCount + 1,
      generated_insights: generated_insights || {},
      chart_config: chart_config || {},
      last_computed_at: Firestore.FieldValue.serverTimestamp(),
      computed_for_submission_count: submissions.length,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      fields_exist: true,
      missing_fields: []
    };
    
    await gcpClient.collection('custom_analyses').doc(analysisId).set(analysisDoc);
    
    res.json({
      success: true,
      analysis_id: analysisId
    });
  } catch (error) {
    console.error('Error saving custom analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save analysis'
    });
  }
});

// Get saved custom analyses
app.get('/api/analytics/forms/:formId/custom/saved',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id; // From middleware (defensive check)
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    
    // Get saved analyses (form-level, shared with all collaborators)
    // Note: Use in-memory sort to avoid Firestore composite index requirement
    const snapshot = await gcpClient.collection('custom_analyses')
      .where('form_id', '==', formId)
      .limit(10)
      .get();
    
    // Validate field existence
    const form = await gcpClient.getFormStructure(formId, true);
    const currentFields = form?.structure?.fields || form?.fields || [];
    
    // Get current submission count for cache freshness
    const dateRangeParam = req.query.dateRange || '30';
    const dateRange = parseInt(dateRangeParam.toString().replace(/d$/, '')) || 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - dateRange);
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
    
    // Map and validate analyses
    const analyses = snapshot.docs.map(doc => {
      const analysis = doc.data();
      
      // Check if fields still exist
      const primaryExists = currentFields.some(f => f.id === analysis.selected_fields.primary.id);
      const secondaryExists = currentFields.some(f => f.id === analysis.selected_fields.secondary.id);
      
      const fieldsExist = primaryExists && secondaryExists;
      const missingFields = [];
      if (!primaryExists) missingFields.push(analysis.selected_fields.primary.label);
      if (!secondaryExists) missingFields.push(analysis.selected_fields.secondary.label);
      
      return {
        ...analysis,
        fields_exist: fieldsExist,
        missing_fields: missingFields
      };
    });
    
    // Sort in memory: pinned first, then by created_at (desc)
    analyses.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return b.pinned ? 1 : -1; // Pinned items first
      }
      // Compare timestamps (handle both Date objects and Firestore Timestamps)
      const aTime = a.created_at?.toMillis ? a.created_at.toMillis() : new Date(a.created_at).getTime();
      const bTime = b.created_at?.toMillis ? b.created_at.toMillis() : new Date(b.created_at).getTime();
      return bTime - aTime; // Most recent first
    });
    
    res.json({
      success: true,
      analyses,
      total_count: analyses.length,
      limit: 10,
      current_submission_count: submissions.length
    });
  } catch (error) {
    console.error('Error fetching saved analyses:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch saved analyses'
    });
  }
});

// Update custom analysis (name, pinned, order)
app.patch('/api/analytics/forms/:formId/custom/saved/:analysisId',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId, analysisId } = req.params;
      const userId = req.user.userId; // From middleware
    
    const { name, pinned, order } = req.body;
    
    // Get existing analysis
    const doc = await gcpClient.collection('custom_analyses').doc(analysisId).get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found'
      });
    }
    
    const analysis = doc.data();
    
    // Verify form_id matches
    if (analysis.form_id !== formId) {
      return res.status(400).json({
        success: false,
        error: 'Analysis does not belong to this form'
      });
    }
    
    // Build update object
    const updateData = {
      updated_at: Firestore.FieldValue.serverTimestamp()
    };
    
    if (name !== undefined) {
      updateData.name = name.substring(0, 50);
    }
    if (pinned !== undefined) {
      updateData.pinned = Boolean(pinned);
    }
    if (order !== undefined) {
      updateData.order = parseInt(order);
    }
    
    await gcpClient.collection('custom_analyses').doc(analysisId).set(updateData, { merge: true });
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error updating custom analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update analysis'
    });
  }
});

// Delete custom analysis
app.delete('/api/analytics/forms/:formId/custom/saved/:analysisId',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId, analysisId } = req.params;
      const userId = req.user.userId; // From middleware
    
    // Get existing analysis
    const doc = await gcpClient.collection('custom_analyses').doc(analysisId).get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found'
      });
    }
    
    const analysis = doc.data();
    
    // Verify form_id matches
    if (analysis.form_id !== formId) {
      return res.status(400).json({
        success: false,
        error: 'Analysis does not belong to this form'
      });
    }
    
    // Delete analysis
    await gcpClient.collection('custom_analyses').doc(analysisId).delete();
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error deleting custom analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete analysis'
    });
  }
});

// Recompute custom analysis (refresh data)
app.post('/api/analytics/forms/:formId/custom/saved/:analysisId/recompute',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId, analysisId } = req.params;
      const userId = req.user.userId; // From middleware
    
    // Get existing analysis
    const doc = await gcpClient.collection('custom_analyses').doc(analysisId).get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found'
      });
    }
    
    const analysis = doc.data();
    
    // Verify form_id matches
    if (analysis.form_id !== formId) {
      return res.status(400).json({
        success: false,
        error: 'Analysis does not belong to this form'
      });
    }
    
    // Get form structure
    const formDoc = await gcpClient.getFormStructure(formId, true);
    if (!formDoc) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }
    
    const fields = formDoc.structure?.fields || formDoc.fields || [];
    const primaryField = fields.find(f => f.id === analysis.selected_fields.primary.id);
    const secondaryField = fields.find(f => f.id === analysis.selected_fields.secondary.id);
    
    if (!primaryField || !secondaryField) {
      return res.status(400).json({
        success: false,
        error: 'Fields not found in form',
        missing_primary: !primaryField,
        missing_secondary: !secondaryField
      });
    }
    
    // Calculate date range
    const dateRangeParam = req.query.dateRange || '30';
    const dateRange = parseInt(dateRangeParam.toString().replace(/d$/, '')) || 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - dateRange);
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);
    
    // Load submissions
    const submissions = await gcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
    
    // Compute analysis
    const { computeCustomAnalysis } = require('./utils/custom-analytics');
    const result = computeCustomAnalysis(
      submissions,
      analysis.template_type,
      primaryField,
      secondaryField,
      {
        filters: analysis.filters || [],
        aggregation: analysis.aggregation || 'mean',
        time_granularity: analysis.time_granularity
      }
    );
    
    // Update analysis with new results
    await gcpClient.collection('custom_analyses').doc(analysisId).set({
      generated_insights: {
        bigNumber: result.bigNumber,
        sampleSize: result.sampleSize,
        strength: result.strength
      },
      chart_config: {
        type: result.chartType,
        data: result.chartData
      },
      last_computed_at: Firestore.FieldValue.serverTimestamp(),
      computed_for_submission_count: submissions.length,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      updated_at: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    res.json({
      success: true,
      analysis: {
        template_type: analysis.template_type,
        selected_fields: analysis.selected_fields,
        bigNumber: result.bigNumber,
        chartType: result.chartType,
        chartData: result.chartData,
        sampleSize: result.sampleSize,
        strength: result.strength
      }
    });
  } catch (error) {
    console.error('Error recomputing custom analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recompute analysis'
    });
  }
});

// ============== USER ANALYTICS ENDPOINT ==============

// Get all analytics for a specific user
app.get('/analytics/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`📊 Fetching analytics for user: ${userId}`);
    
    const analytics = await gcpClient.getUserAnalytics(userId);

    res.json({
      success: true,
      userId,
      analytics,
      count: analytics.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ User analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user analytics',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ALL ANALYTICS ENDPOINT ==============

// Get all analytics data (admin endpoint)
app.get('/analytics', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    console.log(`📊 Fetching all analytics (limit: ${limit})`);
    
    const analytics = await gcpClient.getAllAnalytics(limit);

    res.json({
      success: true,
      analytics,
      count: analytics.length,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ All analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch all analytics',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== GCP INTEGRATION TEST ==============

// Test GCP integration (only in development/testing)
app.get('/test-gcp', async (req, res) => {
  try {
    // Only allow in development or with specific environment variable
    if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_GCP_TEST) {
      return res.status(403).json({
        success: false,
        error: 'GCP test endpoint disabled in production'
      });
    }

    console.log('🧪 Testing GCP integration...');
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Test basic operations
    const testResults = {
      firestore: false,
      storage: false,
      kms: false,
      bigquery: false
    };

    // Test Firestore
    try {
      const testFormId = `test-form-${Date.now()}`;
      const testFormData = { fields: [{ id: 'test', label: 'Test', type: 'text' }] };
      const result = await gcpClient.storeFormStructure(testFormId, testFormData, 'test-user', { isHipaa: false });
      testResults.firestore = result.success;
      console.log('✅ Firestore test passed');
    } catch (error) {
      console.error('❌ Firestore test failed:', error.message);
    }

    // Test KMS
    try {
      const testData = { test: 'data' };
      const encryptResult = await gcpClient.encryptData(testData, 'form-data-key');
      const decryptResult = await gcpClient.decryptData(encryptResult.encryptedData, 'form-data-key');
      testResults.kms = encryptResult.success && decryptResult.success;
      console.log('✅ KMS test passed');
    } catch (error) {
      console.error('❌ KMS test failed:', error.message);
    }

    // Test Cloud Storage
    try {
      const testFilePath = path.join(__dirname, 'test-gcp-file.txt');
      fs.writeFileSync(testFilePath, 'GCP integration test file');
      const result = await gcpClient.uploadFile(testFilePath, `test-uploads/test-${Date.now()}.txt`);
      testResults.storage = result.success;
      fs.unlinkSync(testFilePath); // Clean up
      console.log('✅ Cloud Storage test passed');
    } catch (error) {
      console.error('❌ Cloud Storage test failed:', error.message);
    }

    // Test BigQuery (skip if Jest environment)
    if (!process.env.JEST_WORKER_ID) {
      try {
        const testSubmissionData = {
          submission_id: `test-sub-${Date.now()}`,
          form_id: 'test-form',
          user_id: 'test-user',
          submission_data: { test: 'data' },
          timestamp: new Date(),
          ip_address: '127.0.0.1',
          user_agent: 'GCP Test',
          is_hipaa: false,
          encrypted: false,
        };
        const result = await gcpClient.insertSubmissionAnalytics(testSubmissionData);
        testResults.bigquery = result.success;
        console.log('✅ BigQuery test passed');
      } catch (error) {
        console.error('❌ BigQuery test failed:', error.message);
      }
    } else {
      testResults.bigquery = 'skipped (Jest environment)';
    }

    const allPassed = Object.values(testResults).every(result => result === true || result === 'skipped (Jest environment)');

    res.json({
      success: allPassed,
      timestamp: new Date().toISOString(),
      gcpProject: 'chatterforms',
      testResults,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        isRailway: !!process.env.RAILWAY_PUBLIC_DOMAIN,
        railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || null
      }
    });

  } catch (error) {
    console.error('❌ GCP integration test failed:', error);
    res.status(500).json({
      success: false,
      error: 'GCP integration test failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== SUBMISSION RETRIEVAL ENDPOINTS ==============

// Get submission with file associations
app.get('/submission/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;

    console.log(`📋 Fetching submission: ${submissionId}`);
    
    const submission = await gcpClient.getSubmissionWithFiles(submissionId);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      submission,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Submission retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve submission',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get all submissions for a form with file associations
app.get('/form/:formId/submissions', async (req, res) => {
  try {
    const { formId } = req.params;

    console.log(`📋 Fetching submissions for form: ${formId}`);
    
    const submissions = await gcpClient.getFormSubmissionsWithFiles(formId);

    res.json({
      success: true,
      formId,
      submissions,
      count: submissions.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form submissions retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve form submissions',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== FILE UPLOAD ENDPOINT ==============

app.post('/upload-file', 
  upload.single('file'),
  optionalAuth,  // ✅ Check for auth but don't require it yet (for gradual rollout)
  async (req, res) => {
    try {
      const { formId, fieldId } = req.body
      const file = req.file
      const userId = req.user?.userId || req.user?.id
      
      if (!file || !formId || !fieldId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: file, formId, or fieldId'
        })
      }

      // ✅ NEW: Check authentication requirement
      if (featureFlags.ENABLE_FILE_UPLOAD_AUTH && !userId) {
        console.log(`❌ Unauthenticated file upload attempt blocked - file: ${file.originalname}`);
        
        // Clean up uploaded file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        
        return res.status(401).json({
          success: false,
          error: 'Authentication required for file uploads',
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Please sign in or create an account to upload files. File uploads help us track usage and prevent abuse.',
          action: 'signup_or_login'
        });
      }

      console.log(`📁 File upload: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      console.log(`📁 User: ${userId || 'anonymous'}, Form: ${formId}, Field: ${fieldId}`)

    // Generate unique filename with form and field context
    const timestamp = Date.now()
    const fileExtension = path.extname(file.originalname)
    const fileName = `${formId}/${fieldId}/${timestamp}${fileExtension}`
    
    // Upload to GCP Cloud Storage
    const uploadResult = await gcpClient.uploadFile(
      file.path, 
      `form-uploads/${fileName}`,
      'chatterforms-uploads-us-central1'
    )

    // Clean up local file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path)
      console.log(`🧹 Cleaned up local file: ${file.path}`)
    }

      console.log(`✅ File uploaded successfully: ${fileName}`)
      console.log(`🔗 GCP URL: ${uploadResult.publicUrl}`)
      
      // ✅ NEW: Log upload for audit/abuse prevention
      console.log(`📝 AUDIT: File uploaded - file=${fileName}, user=${userId || 'anonymous'}, size=${file.size}, timestamp=${new Date().toISOString()}`)
      
      // Generate backend file serving URL instead of direct GCP URL
      const backendFileUrl = `${process.env.RAILWAY_PUBLIC_DOMAIN || 'https://my-poppler-api-dev.up.railway.app'}/api/files/${formId}/${fieldId}/${timestamp}${fileExtension}`

      res.json({
        success: true,
        fileUrl: backendFileUrl,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        storedFileName: `${timestamp}${fileExtension}`,
        uploadedBy: userId || 'anonymous',
        uploadedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ File upload error:', error);
      
      // Clean up file on error
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
        console.log(`🧹 Cleaned up local file after error: ${req.file.path}`);
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to upload file',
        details: error.message
      });
    }
  }
);

// ============== LOGO ENDPOINTS ==============

// Upload logo endpoint
app.post('/upload-logo', upload.single('file'), async (req, res) => {
  try {
    const { userId, displayName } = req.body
    const file = req.file
    
    if (!file || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: file or userId'
      })
    }

    console.log(`🖼️ Logo upload request: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB) for user: ${userId}`)

    // Check logo limit (4 logos maximum per user)
    const existingLogos = await gcpClient.getUserLogos(userId)
    if (existingLogos.length >= 4) {
      return res.status(400).json({
        success: false,
        error: 'Maximum of 4 logos allowed per user. Please delete an existing logo before uploading a new one.'
      })
    }

    // Generate unique filename with user context
    const timestamp = Date.now()
    const fileExtension = path.extname(file.originalname)
    const logoId = `logo_${timestamp}_${crypto.randomBytes(8).toString('hex')}`
    const fileName = `${userId}/logos/${logoId}${fileExtension}`
    
    // Upload to GCP Cloud Storage
    const uploadResult = await gcpClient.uploadFile(
      file.path, 
      `user-logos/${fileName}`,
      'chatterforms-uploads-us-central1'
    )

    // Clean up local file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path)
      console.log(`🧹 Cleaned up local file: ${file.path}`)
    }

    // Store logo metadata in Firestore
    const logoData = {
      id: logoId,
      userId: userId,
      fileName: file.originalname,
      displayName: displayName || file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      gcpUrl: uploadResult.url,
      publicUrl: uploadResult.publicUrl,
      uploadedAt: new Date().toISOString(),
      isActive: true
    }

    await gcpClient.storeLogoMetadata(logoData)

    console.log(`✅ Logo uploaded successfully: ${logoId}`)
    console.log(`🔗 GCP URL: ${uploadResult.publicUrl}`)
    
    // Use backend proxy URL to avoid CORS issues (same as getUserLogos)
    const rawBase = process.env.RAILWAY_PUBLIC_DOMAIN || 'https://my-poppler-api-dev.up.railway.app';
    const baseUrl = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
    const backendUrl = `${baseUrl}/api/files/logo/${userId}/${logoId}`;

    res.json({
      success: true,
      logo: {
        id: logoId,
        url: backendUrl,
        displayName: displayName || file.originalname,
        position: 'center',
        height: 150,
        uploadedAt: logoData.uploadedAt
      }
    })

  } catch (error) {
    console.error('❌ Logo upload error:', error)
    
    // Clean up local file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
      console.log(`🧹 Cleaned up local file after error: ${req.file.path}`)
    }
    
    res.status(500).json({
      success: false,
      error: 'Logo upload failed',
      details: error.message
    })
  }
})

// Get user logos endpoint
app.get('/user-logos/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    console.log(`🖼️ Getting logos for user: ${userId}`)

    const logos = await gcpClient.getUserLogos(userId)
    
    res.json({
      success: true,
      logos: logos
    })

  } catch (error) {
    console.error('❌ Get user logos error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user logos',
      details: error.message
    })
  }
})

// Delete logo endpoint
app.delete('/delete-logo/:logoId', async (req, res) => {
  try {
    const { logoId } = req.params
    const { userId } = req.body
    
    if (!logoId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Logo ID and User ID are required'
      })
    }

    console.log(`🗑️ Deleting logo: ${logoId} for user: ${userId}`)

    // Delete logo from GCP and Firestore
    const result = await gcpClient.deleteLogo(logoId, userId)
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error || 'Logo not found or deletion failed'
      })
    }

    console.log(`✅ Logo deleted successfully: ${logoId}`)
    
    res.json({
      success: true,
      message: 'Logo deleted successfully'
    })

  } catch (error) {
    console.error('❌ Delete logo error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to delete logo',
      details: error.message
    })
  }
})

// ============== TEMPORARY ADMIN ENDPOINTS ==============

// Temporary endpoint to delete all logos for a user (for testing)
app.delete('/admin/delete-all-logos/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      })
    }

    console.log(`🗑️ Admin: Deleting all logos for user: ${userId}`)

    // Get all logos for the user
    const logosSnapshot = await gcpClient
      .collection('user_logos')
      .where('userId', '==', userId)
      .get()
    
    let deletedCount = 0
    const deletePromises = []
    
    logosSnapshot.forEach(doc => {
      const logoData = doc.data()
      deletePromises.push(
        gcpClient.deleteLogo(doc.id, userId).then(result => {
          if (result.success) {
            deletedCount++
            console.log(`✅ Deleted logo: ${doc.id}`)
          }
        })
      )
    })
    
    await Promise.all(deletePromises)
    
    console.log(`✅ Admin: Deleted ${deletedCount} logos for user: ${userId}`)
    
    res.json({
      success: true,
      message: `Deleted ${deletedCount} logos for user ${userId}`,
      deletedCount
    })

  } catch (error) {
    console.error('❌ Admin delete all logos error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to delete logos',
      details: error.message
    })
  }
})

// ============== FORM IMAGE ENDPOINTS ==============

// Upload form image endpoint
app.post('/upload-form-image', upload.single('file'), async (req, res) => {
  try {
    const { formId, fieldId, userId, sequence } = req.body
    const file = req.file
    
    if (!file || !formId || !fieldId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: file, formId, fieldId, or userId'
      })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPG, PNG, GIF, and WebP images are allowed.'
      })
    }

    console.log(`🖼️ Form image upload request: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB) for form: ${formId}, field: ${fieldId}, user: ${userId}, sequence: ${sequence}`)

    // Check image limit (10 images maximum per field)
    const existingImages = await gcpClient.getFormImages(formId, fieldId)
    if (existingImages.length >= 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum of 10 images allowed per field. Please delete an existing image before uploading a new one.'
      })
    }

    // Use provided sequence or fallback to next available sequence
    const nextSequence = sequence !== undefined ? parseInt(sequence) : existingImages.length
    console.log(`🔄 Sequence handling: provided=${sequence}, parsed=${nextSequence}, existingCount=${existingImages.length}`)

    // Generate unique filename with form and field context
    const timestamp = Date.now()
    const fileExtension = path.extname(file.originalname)
    const imageId = `img_${timestamp}_${crypto.randomBytes(8).toString('hex')}`
    const fileName = `${formId}/${fieldId}/${imageId}${fileExtension}`
    
    // Upload to GCP Cloud Storage
    const uploadResult = await gcpClient.uploadFile(
      file.path, 
      `form-images/${fileName}`,
      'chatterforms-uploads-us-central1'
    )

    // Clean up local file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path)
      console.log(`🧹 Cleaned up local file: ${file.path}`)
    }

    // Store image metadata in Firestore
    const imageData = {
      id: imageId,
      formId: formId,
      fieldId: fieldId,
      userId: userId,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      gcpUrl: uploadResult.url,
      publicUrl: uploadResult.publicUrl,
      uploadedAt: new Date().toISOString(),
      sequence: nextSequence,
      isActive: true,
      type: 'form_image' // Tag to distinguish from logos
    }

    await gcpClient.storeFormImageMetadata(imageData)

    console.log(`✅ Form image uploaded successfully: ${imageId}`)
    console.log(`🔗 GCP URL: ${uploadResult.publicUrl}`)
    
    // Use backend proxy URL to avoid CORS issues
    const rawBase = process.env.RAILWAY_PUBLIC_DOMAIN || 'https://my-poppler-api-dev.up.railway.app';
    const baseUrl = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
    const backendUrl = `${baseUrl}/api/files/form-image/${formId}/${fieldId}/${imageId}`;

    res.json({
      success: true,
      image: {
        id: imageId,
        url: backendUrl,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        position: 'center',
        height: 200,
        sequence: nextSequence,
        uploadedAt: imageData.uploadedAt
      }
    })

  } catch (error) {
    console.error('❌ Form image upload error:', error)
    
    // Clean up local file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
      console.log(`🧹 Cleaned up local file after error: ${req.file.path}`)
    }
    
    res.status(500).json({
      success: false,
      error: 'Form image upload failed',
      details: error.message
    })
  }
})

// Get form images endpoint
app.get('/form-images/:formId/:fieldId', async (req, res) => {
  try {
    const { formId, fieldId } = req.params
    
    if (!formId || !fieldId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID and Field ID are required'
      })
    }

    console.log(`🖼️ Getting form images for form: ${formId}, field: ${fieldId}`)

    const images = await gcpClient.getFormImages(formId, fieldId)

    res.json({
      success: true,
      images: images
    })

  } catch (error) {
    console.error('❌ Error getting form images:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get form images',
      details: error.message
    })
  }
})

// Delete form image endpoint
app.delete('/form-image/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params
    const { userId } = req.body
    
    if (!imageId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Image ID and User ID are required'
      })
    }

    console.log(`🗑️ Deleting form image: ${imageId} for user: ${userId}`)

    const result = await gcpClient.deleteFormImage(imageId, userId)

    if (result.success) {
      res.json({
        success: true,
        message: 'Form image deleted successfully'
      })
    } else {
      res.status(404).json({
        success: false,
        error: result.error || 'Form image not found'
      })
    }

  } catch (error) {
    console.error('❌ Error deleting form image:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to delete form image',
      details: error.message
    })
  }
})

// Update image sequence endpoint
app.put('/form-images/:formId/:fieldId/sequence', async (req, res) => {
  try {
    const { formId, fieldId } = req.params
    const { images } = req.body
    
    if (!formId || !fieldId || !images || !Array.isArray(images)) {
      return res.status(400).json({
        success: false,
        error: 'Form ID, Field ID, and images array are required'
      })
    }

    console.log(`🔄 Updating image sequence for form: ${formId}, field: ${fieldId}`)
    console.log('🔄 Images to update:', images.map(img => ({ id: img.id, fileName: img.fileName, sequence: img.sequence })))

    // Validate that all image IDs exist in Firestore before updating
    console.log('🔍 Validating image IDs exist in database...')
    const validationPromises = images.map(async (image) => {
      try {
        const doc = await gcpClient.collection('form_images').doc(image.id).get()
        if (!doc.exists) {
          throw new Error(`Image ${image.id} not found in database`)
        }
        console.log(`✅ Image ${image.id} validated`)
        return true
      } catch (error) {
        console.error(`❌ Validation failed for image ${image.id}:`, error.message)
        throw error
      }
    })
    
    await Promise.all(validationPromises)
    console.log('✅ All image IDs validated successfully')

    // Update sequence for each image using the provided sequence number
    const updatePromises = images.map((image) => 
      gcpClient.updateImageSequence(image.id, image.sequence)
    )

    await Promise.all(updatePromises)

    res.json({
      success: true,
      message: 'Image sequence updated successfully'
    })

  } catch (error) {
    console.error('❌ Error updating image sequence:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update image sequence',
      details: error.message
    })
  }
})

// ============== FILE SERVING ENDPOINTS ==============

// Serve logo files through backend to avoid CORS issues
app.get('/api/files/logo/:userId/:logoId', async (req, res) => {
  try {
    const { userId, logoId } = req.params
    
    if (!userId || !logoId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Logo ID are required'
      })
    }

    console.log(`🖼️ Serving logo file: ${logoId} for user: ${userId}`)

    // Get logo metadata from Firestore
    const logoRef = gcpClient.collection('user_logos').doc(logoId)
    const logoDoc = await logoRef.get()
    
    if (!logoDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Logo not found'
      })
    }
    
    const logoData = logoDoc.data()
    
    // Verify the logo belongs to the user
    if (logoData.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Logo does not belong to user'
      })
    }
    
    // Get the file from GCP Storage
    const gcpUrl = logoData.gcpUrl
    if (gcpUrl && gcpUrl.startsWith('gs://')) {
      const bucketName = gcpUrl.split('/')[2]
      const fileName = gcpUrl.split('/').slice(3).join('/')
      
      const bucket = gcpClient.storage.bucket(bucketName)
      const file = bucket.file(fileName)
      
      // Check if file exists
      const [exists] = await file.exists()
      if (!exists) {
        return res.status(404).json({
          success: false,
          error: 'Logo file not found in storage'
        })
      }
      
      // Set appropriate headers
      res.set({
        'Content-Type': logoData.fileType || 'image/png',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'Access-Control-Allow-Origin': '*', // Allow CORS
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
      
      // Stream the file
      file.createReadStream().pipe(res)
      
      console.log(`✅ Logo file served: ${fileName}`)
    } else {
      return res.status(404).json({
        success: false,
        error: 'Invalid logo file path'
      })
    }

  } catch (error) {
    console.error('❌ Error serving logo file:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to serve logo file',
      details: error.message
    })
  }
})

// Serve form image files through backend to avoid CORS issues
app.get('/api/files/form-image/:formId/:fieldId/:imageId', async (req, res) => {
  try {
    const { formId, fieldId, imageId } = req.params
    
    if (!formId || !fieldId || !imageId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID, Field ID, and Image ID are required'
      })
    }

    console.log(`🖼️ Serving form image file: ${imageId} for form: ${formId}, field: ${fieldId}`)

    // Get image metadata from Firestore
    const imageRef = gcpClient.collection('form_images').doc(imageId)
    const imageDoc = await imageRef.get()
    
    if (!imageDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Form image not found'
      })
    }
    
    const imageData = imageDoc.data()
    
    // Verify the image belongs to the form and field
    if (imageData.formId !== formId || imageData.fieldId !== fieldId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Image does not belong to this form/field'
      })
    }
    
    // Get the file from GCP Storage
    const gcpUrl = imageData.gcpUrl
    if (gcpUrl && gcpUrl.startsWith('gs://')) {
      const bucketName = gcpUrl.split('/')[2]
      const fileName = gcpUrl.split('/').slice(3).join('/')
      
      const bucket = gcpClient.storage.bucket(bucketName)
      const file = bucket.file(fileName)
      
      // Check if file exists
      const [exists] = await file.exists()
      if (!exists) {
        return res.status(404).json({
          success: false,
          error: 'Form image file not found in storage'
        })
      }
      
      // Set appropriate headers
      res.set({
        'Content-Type': imageData.fileType || 'image/png',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'Access-Control-Allow-Origin': '*', // Allow CORS
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
      
      // Stream the file
      file.createReadStream().pipe(res)
      
      console.log(`✅ Form image file served: ${fileName}`)
    } else {
      return res.status(404).json({
        success: false,
        error: 'Invalid form image file path'
      })
    }

  } catch (error) {
    console.error('❌ Error serving form image file:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to serve form image file',
      details: error.message
    })
  }
})

// ============== DEBUG ENDPOINTS ==============

// Debug endpoint to check payment fields for a form
app.get('/api/debug/payment-fields/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    console.log(`🔍 DEBUG: Getting payment fields for form: ${formId}`);
    
    const paymentFields = await gcpClient.getPaymentFields(formId);
    
    res.json({
      success: true,
      formId,
      count: paymentFields.length,
      fields: paymentFields.map(field => ({
        id: field.id,
        field_id: field.field_id,
        form_id: field.form_id,
        stripe_account_id: field.stripe_account_id,
        amount: field.amount,
        currency: field.currency,
        product_name: field.product_name,
        description: field.description,
        created_at: field.created_at,
        updated_at: field.updated_at
      }))
    });
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment fields'
    });
  }
});

// Cleanup endpoint to remove duplicate payment fields
app.post('/api/debug/cleanup-payment-fields/:formId/:fieldId', async (req, res) => {
  try {
    const { formId, fieldId } = req.params;
    console.log(`🧹 CLEANUP: Cleaning up duplicate payment fields for form: ${formId}, field: ${fieldId}`);
    
    const fieldsQuery = await gcpClient
      .collection('payment_fields')
      .where('form_id', '==', formId)
      .where('field_id', '==', fieldId)
      .get();

    if (fieldsQuery.empty) {
      return res.json({
        success: true,
        message: 'No payment fields found to clean up',
        deleted: 0
      });
    }

    if (fieldsQuery.docs.length === 1) {
      return res.json({
        success: true,
        message: 'Only one payment field found, no cleanup needed',
        deleted: 0
      });
    }

    // Sort by created_at to keep the most recent
    const sortedDocs = fieldsQuery.docs.sort((a, b) => {
      const aTime = a.data().created_at?._seconds || 0;
      const bTime = b.data().created_at?._seconds || 0;
      return bTime - aTime; // Most recent first
    });
    
    // Keep the most recent, delete the rest
    const keepDoc = sortedDocs[0];
    const deleteDocs = sortedDocs.slice(1);
    
    console.log(`🧹 Keeping document: ${keepDoc.id}`);
    console.log(`🧹 Deleting ${deleteDocs.length} duplicate documents`);
    
    // Delete duplicates
    const batch = gcpClient.firestore.batch();
    deleteDocs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    console.log(`✅ Cleaned up ${deleteDocs.length} duplicate payment fields`);
    
    res.json({
      success: true,
      message: `Cleaned up ${deleteDocs.length} duplicate payment fields`,
      deleted: deleteDocs.length,
      kept: keepDoc.id
    });
  } catch (error) {
    console.error('❌ Cleanup endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup payment fields'
    });
  }
});

// ============== FILE SERVING ENDPOINT ==============

// Serve uploaded files securely
app.get('/api/files/:formId/:fieldId/:filename',
  optionalAuth,  // ✅ Check for auth
  async (req, res) => {
    try {
      const { formId, fieldId, filename } = req.params;
      const userId = req.user?.userId || req.user?.id;
      
      console.log(`📁 File request: ${filename} for form: ${formId}, field: ${fieldId}`);
      console.log(`📁 Requesting user: ${userId || 'anonymous'}`);
      
      // ✅ NEW: Check if user has access to the form
      if (userId) {
        // Authenticated user - verify form access
        const { verifyFormAccess } = require('./auth/authorization');
        const { hasAccess, reason } = await verifyFormAccess(userId, formId);
        
        if (!hasAccess) {
          console.warn(`❌ File access denied: user=${userId}, form=${formId}, file=${filename}, reason=${reason}`);
          
          return res.status(403).json({
            success: false,
            error: 'Forbidden: You do not have access to this file',
            code: 'ACCESS_DENIED',
            reason
          });
        }
        
        console.log(`✅ File access granted: user=${userId}, form=${formId}, reason=${reason}`);
      } else {
        // ✅ NEW: For anonymous users, only allow access to files from published forms
        const form = await gcpClient.getFormStructure(formId, true);
        
        if (!form) {
          return res.status(404).json({
            success: false,
            error: 'Form not found'
          });
        }
        
        // Check if form is published
        if (!form.is_published && !form.isPublished) {
          console.warn(`❌ Anonymous file access denied: form not published - form=${formId}, file=${filename}`);
          
          return res.status(403).json({
            success: false,
            error: 'Forbidden: Please sign in to access files from unpublished forms',
            code: 'AUTHENTICATION_REQUIRED',
            action: 'signup_or_login'
          });
        }
        
        console.log(`✅ Anonymous file access granted: published form=${formId}`);
      }
      
      // Construct the file path in GCP Storage
      const filePath = `form-uploads/${formId}/${fieldId}/${filename}`;
      
      // Get file from GCP Cloud Storage
      const bucket = gcpClient.storage.bucket('chatterforms-uploads-us-central1');
      const file = bucket.file(filePath);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        console.warn(`❌ File not found: ${filePath}`);
        return res.status(404).json({
          success: false,
          error: 'File not found'
        });
      }
      
      // Get file metadata
      const [metadata] = await file.getMetadata();
      
      // ✅ NEW: Audit log for file access
      console.log(`📝 AUDIT: File accessed - file=${filename}, user=${userId || 'anonymous'}, form=${formId}, timestamp=${new Date().toISOString()}`);
      
      // Set appropriate headers
      res.set({
        'Content-Type': metadata.contentType || 'application/octet-stream',
        'Content-Length': metadata.size,
        'Cache-Control': 'private, max-age=3600', // ✅ Changed from 'public' to 'private'
        'Content-Disposition': `inline; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff', // ✅ NEW: Prevent MIME sniffing
        'X-Frame-Options': 'SAMEORIGIN' // ✅ NEW: Prevent clickjacking
      });
      
      // Stream the file to the response
      const stream = file.createReadStream();
      stream.pipe(res);
      
      stream.on('error', (error) => {
        console.error('❌ Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to stream file'
          });
        }
      });
      
    } catch (error) {
      console.error('❌ Error serving file:', error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Failed to serve file',
          details: error.message
        });
      }
    }
  }
);

// ============== USER FORMS ENDPOINT ==============

app.get('/api/forms/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    console.log(`📋 Fetching forms for user: ${userId}`);
    
    const forms = await gcpClient.getFormsByUserId(userId);

    res.json({
      success: true,
      userId,
      forms,
      count: forms.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ User forms retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user forms',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== SINGLE FORM ENDPOINT ==============

app.get('/api/forms/:formId',
  optionalAuth,  // ✅ Check for auth but don't require
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user?.userId || req.user?.id;
      
      if (!formId) {
        return res.status(400).json({
          success: false,
          error: 'Form ID is required'
        });
      }

      console.log(`📋 Fetching form: ${formId}, user: ${userId || 'anonymous'}`);
      
      // Get the form data from GCP with fresh read to avoid cache issues after updates
      const form = await gcpClient.getFormStructure(formId, true);

      if (!form) {
        return res.status(404).json({
          success: false,
          error: 'Form not found',
          formId,
          timestamp: new Date().toISOString()
        });
      }

      // ✅ NEW: Check access based on publish status
      const isPublished = form.is_published || form.isPublished;
      
      if (!isPublished) {
        // Draft form - require ownership
        if (!userId) {
          console.warn(`❌ Anonymous access denied to draft form: ${formId}`);
          return res.status(401).json({
            success: false,
            error: 'Authentication required to access unpublished forms',
            code: 'AUTHENTICATION_REQUIRED',
            action: 'signup_or_login'
          });
        }
        
        // Verify ownership
        const { verifyFormAccess } = require('./auth/authorization');
        const { hasAccess, reason } = await verifyFormAccess(userId, formId);
        
        if (!hasAccess) {
          console.warn(`❌ Access denied to draft form: user=${userId}, form=${formId}, reason=${reason}`);
          return res.status(403).json({
            success: false,
            error: 'Forbidden: You do not have access to this form',
            code: 'ACCESS_DENIED',
            reason
          });
        }
        
        console.log(`✅ Draft form access granted: user=${userId}, form=${formId}`);
      } else {
        // Published form - allow public access
        console.log(`✅ Public form access granted: form=${formId}`);
      }

      // Prevent any intermediary/proxy/browser caching
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');

      res.json({
        success: true,
        form,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Form retrieval error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve form',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ============== SIGNATURE DOWNLOAD ENDPOINT ==============
app.get('/api/submissions/:submissionId/signature/:fieldId',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireSubmissionOwnership,  // ✅ Verify submission ownership
  async (req, res) => {
  try {
    const { submissionId, fieldId } = req.params;

    console.log(`📝 Requesting signature for submission ${submissionId}, field ${fieldId}`);

    // Get submission data
    const submissionRef = gcpClient.collection('submissions').doc(submissionId);
    const submissionDoc = await submissionRef.get();

    if (!submissionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    const submissionData = submissionDoc.data();
    const signatureData = submissionData.signatures?.[fieldId];

    if (!signatureData) {
      return res.status(404).json({
        success: false,
        error: 'Signature not found for this field'
      });
    }

    // Generate signed URL for signature download
    const bucketName = signatureData.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';
    
    console.log(`📝 Attempting to generate signed URL for: ${signatureData.filename}`);
    console.log(`📝 Using bucket: ${bucketName}`);
    
    // Check if file exists first
    const file = gcpClient.storage.bucket(bucketName).file(signatureData.filename);
    const [exists] = await file.exists();
    
    if (!exists) {
      console.error(`❌ File does not exist: ${signatureData.filename}`);
      return res.status(404).json({
        success: false,
        error: 'Signature file not found in storage'
      });
    }
    
    console.log(`✅ File exists, generating signed URL...`);
    
    const downloadUrl = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + (60 * 60 * 1000) // 1 hour expiration
    });

    console.log(`📝 Generated signed URL for signature: ${signatureData.filename}`);
    console.log(`📝 Download URL: ${downloadUrl[0]}`);

    res.json({
      success: true,
      downloadUrl: downloadUrl[0],
      filename: signatureData.filename,
      size: signatureData.size,
      method: signatureData.method,
      completedAt: signatureData.completedAt,
      timezone: signatureData.timezone
    });

  } catch (error) {
    console.error('❌ Error retrieving signature:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve signature'
    });
  }
});

// ============== PDF DOWNLOAD ENDPOINT ==============
app.get('/api/submissions/:submissionId/pdf/:fieldId',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireSubmissionOwnership,  // ✅ Verify submission ownership
  async (req, res) => {
    try {
      const { submissionId, fieldId } = req.params;
      const userId = req.user.userId;

      console.log(`📄 Requesting PDF: submission=${submissionId}, field=${fieldId}, user=${userId}`);
      
      // Ownership already verified by middleware

      // Get submission data
      const submissionRef = gcpClient.collection('submissions').doc(submissionId);
      const submissionDoc = await submissionRef.get();

    if (!submissionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    const submissionData = submissionDoc.data();
    const pdfData = submissionData.pdfs?.[fieldId];

    if (!pdfData) {
      return res.status(404).json({
        success: false,
        error: 'PDF not found for this field'
      });
    }

    // Generate signed URL for PDF download
    const downloadUrl = await gcpClient.pdfGenerator.getPDFDownloadURL(
      pdfData.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1',
      pdfData.filename,
      60 // 60 minutes expiration
    );

    console.log(`📄 Generated signed URL for PDF: ${pdfData.filename}`);
    console.log(`📄 Download URL: ${downloadUrl}`);
    console.log(`📄 PDF size: ${Math.round(pdfData.size/1024)}KB`);
    console.log(`📄 HIPAA: ${pdfData.isHipaa}`);

    res.json({
      success: true,
      downloadUrl,
      filename: pdfData.filename,
      size: pdfData.size,
      generatedAt: pdfData.generatedAt
    });

  } catch (error) {
    console.error('❌ Error retrieving PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve PDF'
    });
  }
});

// ============== GET FORM SUBMISSIONS ENDPOINT ==============
app.get('/api/forms/:formId/submissions', 
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user.userId;
      
      console.log(`📋 Fetching submissions: form=${formId}, user=${userId}`);
      
      // Form ownership already verified by middleware
      
      // Initialize GCP client
      const GCPClient = require('./gcp-client');
      const gcpClient = new GCPClient();
      
      // Get submissions from BigQuery
      const submissions = await gcpClient.getFormSubmissions(formId);
      
      if (submissions) {
        console.log(`✅ Retrieved ${submissions.length} submissions for form: ${formId}`);
        res.json({
          success: true,
          formId,
          submissions,
          count: submissions.length,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`📤 Sending empty response for form: ${formId}`);
        res.json({
          success: true,
          formId,
          submissions: [],
          count: 0,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('❌ Error fetching form submissions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch form submissions',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ============== PAGINATED FORM SUBMISSIONS ENDPOINT ==============
app.get('/api/forms/:formId/submissions/paginated',
  authenticateToken,
  requireAuth,
  requireFormOwnership,
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user.userId;
      const { 
        page = 1, 
        limit = 20, 
        sort = 'desc',
        search = '',
        dateFrom = '',
        dateTo = ''
      } = req.query;
      
      console.log(`📋 Fetching paginated submissions: form=${formId}, user=${userId}, page=${page}`);
      
      // Form ownership already verified by middleware
      
      // Initialize GCP client
      const GCPClient = require('./gcp-client');
      const gcpClient = new GCPClient();
      
      // Get paginated submissions
      const result = await gcpClient.getFormSubmissionsPaginated(
        formId, 
        parseInt(limit), 
        (parseInt(page) - 1) * parseInt(limit), 
        sort,
        search,
        dateFrom,
        dateTo
      );
      
      console.log(`✅ Retrieved ${result.submissions.length} submissions (page ${page}) for form: ${formId}`);
      console.log(`📊 Total submissions: ${result.total}, HasNext: ${result.hasNext}, HasPrev: ${result.hasPrev}`);
      
      res.json({
        success: true,
        formId,
        submissions: result.submissions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / parseInt(limit)),
          hasNext: result.hasNext,
          hasPrev: result.hasPrev
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error fetching paginated form submissions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch paginated form submissions',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ============== LAZY SUBMISSION DATA LOADING ==============
app.get('/api/submissions/:submissionId/data',
  authenticateToken,
  requireAuth,
  requireSubmissionOwnership,  // ✅ Verify submission access via form ownership
  async (req, res) => {
    try {
      const { submissionId } = req.params;
      const userId = req.user.userId;
      
      // Ownership already verified by middleware
      // req.submission contains the submission data
      // req.formId contains the form ID
      
      // Initialize GCP client
      const GCPClient = require('./gcp-client');
      const gcpClient = new GCPClient();
      
      // Get submission data on demand
      const submissionData = await gcpClient.getSubmissionData(submissionId);
      
      if (submissionData !== null) {
        console.log(`✅ Loaded submission data: ${submissionId} for user ${userId}`);
        res.json({
          success: true,
          submissionId,
          submission_data: submissionData,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`❌ No submission data found for: ${submissionId}`);
        res.status(404).json({
          success: false,
          error: 'Submission data not found'
        });
      }
    } catch (error) {
      console.error('❌ Error loading submission data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load submission data',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ============== SIGNATURE SIGNED URLS (BATCH) ==============

app.get('/api/submissions/:submissionId/signatures',
  authenticateToken,
  requireAuth,
  requireSubmissionOwnership,
  async (req, res) => {
    try {
      const { submissionId } = req.params;
      const userId = req.user.userId;
      
      // Ownership already verified by middleware
      
      console.log(`🖊️ Fetching signature URLs: submission=${submissionId}, user=${userId}`);
      const urls = await gcpClient.getSignatureSignedUrls(submissionId);
      res.json({ success: true, submissionId, urls, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('❌ Error fetching signature URLs:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch signature URLs' });
    }
  }
);

// ============== PDF GENERATE-OR-RETURN ==============

app.post('/api/submissions/:submissionId/pdf/:fieldId/generate-or-return',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireSubmissionOwnership,  // ✅ Verify submission ownership
  async (req, res) => {
    try {
      const { submissionId, fieldId } = req.params;
      const userId = req.user.userId;
      
      console.log(`📄 Generate-or-return PDF: submission=${submissionId}, field=${fieldId}, user=${userId}`);
      
      // Ownership already verified by middleware
      const result = await gcpClient.getOrCreateSignedPDF(submissionId, fieldId);
      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }
      res.json({ success: true, downloadUrl: result.downloadUrl, filename: result.filename, size: result.size });
    } catch (error) {
      console.error('❌ Error generate-or-return PDF:', error);
      res.status(500).json({ success: false, error: 'Failed to generate or retrieve PDF' });
    }
  }
);

// ============== DELETE FORM ENDPOINT ==============
app.delete('/api/forms/:formId',
  authenticateToken,      // ✅ Verify JWT token
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    try {
      const { formId } = req.params;
      const userId = req.user.userId;
      
      console.log(`🗑️ Delete request: form=${formId}, user=${userId}`);
      
      // Form ownership already verified by middleware
      // req.form contains the form data
      
      // Initialize GCP client
      const GCPClient = require('./gcp-client');
      const gcpClient = new GCPClient();
      
      // Delete form and all associated data (submissions, analytics)
      const result = await gcpClient.deleteForm(formId);
      
      if (result.success) {
        console.log(`✅ Form deleted successfully: ${formId} by user ${userId}`);
        
        // Audit log
        console.log(`📝 AUDIT: Form deleted - formId=${formId}, userId=${userId}, timestamp=${new Date().toISOString()}`);
        
        res.json({ 
          success: true, 
          message: 'Form and all associated data deleted successfully',
          formId,
          timestamp: new Date().toISOString()
        });
      } else {
        console.error(`❌ Failed to delete form: ${formId}`, result.error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to delete form', 
          details: result.error,
          timestamp: new Date().toISOString() 
        });
      }
    } catch (error) {
      console.error('❌ Form deletion error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to delete form', 
        details: error.message, 
        timestamp: new Date().toISOString() 
      });
    }
  }
);

// ============== FORM MIGRATION ENDPOINT ==============

app.post('/api/forms/migrate-anonymous', async (req, res) => {
  try {
    const { tempUserId, realUserId } = req.body;
    
    if (!tempUserId || !realUserId) {
      return res.status(400).json({
        success: false,
        error: 'Both temporary user ID and real user ID are required'
      });
    }

    console.log(`🔄 Migrating forms from ${tempUserId} to ${realUserId}`);
    
    const gcpClient = new GCPClient();
    const result = await gcpClient.migrateAnonymousForms(realUserId, tempUserId);

    res.json({
      success: true,
      message: 'Forms migrated successfully',
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Form migration failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANONYMOUS SESSION CLEANUP ENDPOINT ==============

app.get('/api/cleanup/expired-sessions', async (req, res) => {
  try {
    console.log('🧹 Starting cleanup of expired anonymous sessions...');
    
    const gcpClient = new GCPClient();
    const result = await gcpClient.cleanupExpiredAnonymousSessions();

    res.json({
      success: true,
      message: 'Cleanup completed successfully',
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== AUTHENTICATION ROUTES ==============

// Import authentication routes
const authRoutes = require('./auth/routes');

// Import billing routes
const billingRoutes = require('./routes/billing');

// Import BAA routes
const baaRoutes = require('./routes/baa');

// Import image analysis routes
const imageAnalysisRoutes = require('./routes/image-analysis');
const urlAnalysisRoutes = require('./routes/url-analysis');
const urlAnalysisHtmlRoutes = require('./routes/url-analysis-html');
const googleVisionTestRoutes = require('./routes/google-vision-test');
const screenshotPagesRoutes = require('./routes/screenshot-pages');

// Mount authentication routes
app.use('/auth', authRoutes);

// Mount billing routes
app.use('/api/billing', billingRoutes);

// Mount BAA routes
app.use('/api/baa', baaRoutes);

// Mount image analysis routes
app.use('/api', imageAnalysisRoutes);
app.use('/api', urlAnalysisRoutes);
app.use('/api', urlAnalysisHtmlRoutes);
app.use('/api', googleVisionTestRoutes);
app.use('/', screenshotPagesRoutes);

// ============== AUTO-SAVE ENDPOINT ==============

app.post('/api/auto-save-form', async (req, res) => {
  try {
    const { formId, formSchema } = req.body;
    
    console.log('🔄 Auto-save API received:', {
      formId,
      hasFormSchema: !!formSchema
    });

    if (!formId || !formSchema) {
      return res.status(400).json({
        error: 'Form ID and schema are required'
      });
    }

    // Get the current form to preserve its published status
    const currentForm = await gcpClient.getFormById(formId);
    const currentPublishedStatus = currentForm?.is_published || false;

    // Use HIPAA setting from the form schema being sent (not from database)
    const hipaaStatus = formSchema?.isHipaa || false;

    // Store the form structure with auto-save metadata
    const result = await gcpClient.storeFormStructure(
      formId,
      formSchema,
      currentForm?.user_id || 'anonymous',
      {
        source: 'auto-save',
        isUpdate: true,
        isPublished: currentPublishedStatus, // Preserve existing published status
        isHipaa: hipaaStatus, // Use HIPAA status from the form schema being sent
        updatedAt: new Date().toISOString()
      }
    );

    if (result.success) {
      console.log('✅ Auto-save successful for form:', formId);
      return res.json({ 
        success: true, 
        formId,
        message: 'Form auto-saved successfully' 
      });
    } else {
      throw new Error('Failed to auto-save form');
    }

  } catch (error) {
    console.error('❌ Auto-save error:', error);
    return res.status(500).json({
      error: 'Failed to auto-save form'
    });
  }
});

// ============== HEALTH CHECK ==============

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    baseUrl: BASE_URL,
    services: {
      pdf: 'enabled',
      screenshot: 'enabled',
      gcp: 'enabled',
      fileUpload: 'enabled'
    },
    environment: {
      isRailway: !!process.env.RAILWAY_PUBLIC_DOMAIN,
      railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || null,
      port: PORT,
      nodeVersion: process.version,
      gcpProject: 'chatterforms'
    }
  });
});

// ============== EMAIL API ENDPOINTS ==============

// Send form published email
app.post('/api/emails/send-form-published', async (req, res) => {
  try {
    const { userEmail, formTitle, publicUrl } = req.body;
    
    if (!formTitle || !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: formTitle, publicUrl'
      });
    }
    
    console.log(`📧 Form published email request for: ${formTitle}`);
    const result = await emailService.sendFormPublishedEmail(userEmail, formTitle, publicUrl);
    
    if (result.success) {
      if (result.skipped) {
        res.json({
          success: true,
          skipped: true,
          reason: result.reason,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error in form published email endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Send form submission email
app.post('/api/emails/send-form-submission', async (req, res) => {
  try {
    const { userEmail, formTitle, submissionData, isHipaa = false, formId = null } = req.body;
    
    if (!formTitle || !submissionData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: formTitle, submissionData'
      });
    }
    
    console.log(`📧 Form submission email request for: ${formTitle} (HIPAA: ${isHipaa})`);
    const result = await emailService.sendFormSubmissionEmail(userEmail, formTitle, submissionData, isHipaa, formId);
    
    if (result.success) {
      if (result.skipped) {
        res.json({
          success: true,
          skipped: true,
          reason: result.reason,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error in form submission email endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Send form deleted email
app.post('/api/emails/send-form-deleted', async (req, res) => {
  try {
    const { userEmail, formTitle } = req.body;
    
    if (!formTitle) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: formTitle'
      });
    }
    
    console.log(`📧 Form deleted email request for: ${formTitle}`);
    const result = await emailService.sendFormDeletedEmail(userEmail, formTitle);
    
    if (result.success) {
      if (result.skipped) {
        res.json({
          success: true,
          skipped: true,
          reason: result.reason,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error in form deleted email endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============== PAYMENT INTEGRATION ENDPOINTS ==============

const buildStripeOAuthUrl = (userId) => {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const redirectUri = process.env.STRIPE_CONNECT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('OAuth configuration missing (STRIPE_CONNECT_CLIENT_ID / STRIPE_CONNECT_REDIRECT_URI)');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state: userId
  });

  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
};

// Connect Stripe account (OAuth-only helper that returns URL)
app.post('/api/stripe/connect', async (req, res) => {
  try {
    console.log('💳 Stripe Connect (OAuth) request received');
    
    const { userId, nickname } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (req.session) {
      req.session.oauthUserId = userId;
      req.session.pendingStripeNickname = nickname?.trim() || null;
    }

    const authUrl = buildStripeOAuthUrl(userId);
    res.json({
      success: true,
      oauthUrl: authUrl
    });
  } catch (error) {
    console.error('❌ Error generating OAuth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Stripe OAuth link'
    });
  }
});

// OAuth flow for existing Stripe accounts
app.get('/api/stripe/connect-oauth', async (req, res) => {
  try {
    console.log('🔗 OAuth authorization request received');
    
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (req.session) {
      req.session.oauthUserId = userId;
    }

    const authUrl = buildStripeOAuthUrl(userId);
    console.log(`🔗 Redirecting to OAuth: ${authUrl}`);
    res.redirect(authUrl);

  } catch (error) {
    console.error('❌ Error initiating OAuth:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate OAuth flow'
    });
  }
});

// OAuth callback handler
app.get('/api/stripe/connect-callback', async (req, res) => {
  try {
    console.log('🔗 OAuth callback received');
    
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code missing'
      });
    }

    const userId = state || req.session.oauthUserId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID missing from OAuth flow'
      });
    }

    console.log(`🔗 Exchanging code for access token for user: ${userId}`);

    // Exchange authorization code for access token
    const response = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_secret: process.env.STRIPE_SECRET_KEY,
        code: code,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await response.json();

    if (!response.ok) {
      console.error('❌ OAuth token exchange failed:', tokenData);
      return res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code for access token',
        details: tokenData.error_description || tokenData.error
      });
    }

    console.log(`✅ OAuth token exchange successful for user: ${userId}`);

    if (!tokenData.stripe_publishable_key) {
      console.error('❌ OAuth response missing publishable key. Cannot connect account.');
      const frontendUrl = process.env.FRONTEND_URL || 'https://www.chatterforms.com';
      return res.redirect(`${frontendUrl}/settings?stripe_oauth_error=missing_publishable_key`);
    }

    // Store the connected account
    const pendingNickname = req.session?.pendingStripeNickname || null;
    if (req.session && req.session.pendingStripeNickname) {
      delete req.session.pendingStripeNickname;
    }

    const accountId = await gcpClient.storeStripeAccount(
      userId,
      tokenData.stripe_user_id,
      'standard',
      {
        charges_enabled: true,
        details_submitted: true,
        capabilities: tokenData.stripe_publishable_key ? {} : {},
        country: tokenData.country || 'US',
        default_currency: tokenData.default_currency || 'usd',
        email: tokenData.email || '',
        publishable_key: tokenData.stripe_publishable_key || null,
        access_token: tokenData.access_token || null,
        refresh_token: tokenData.refresh_token || null
      },
      pendingNickname || 'Connected via OAuth'
    );

    console.log(`✅ Connected account stored: ${accountId}`);

    // Redirect back to settings page
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.chatterforms.com';
    res.redirect(`${frontendUrl}/settings?stripe_oauth_success=true`);

  } catch (error) {
    console.error('❌ Error handling OAuth callback:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.chatterforms.com';
    res.redirect(`${frontendUrl}/settings?stripe_oauth_error=true`);
  }
});

// Create account link with smart link type selection
app.post('/api/stripe/account-link', async (req, res) => {
  try {
    console.log('🔗 Creating Stripe account link');
    
    const { userId, refreshUrl, returnUrl, linkType } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
        code: 'MISSING_USER_ID'
      });
    }

    // Get user's Stripe account
    const stripeAccount = await gcpClient.getStripeAccount(userId);
    if (!stripeAccount) {
      return res.status(404).json({
        success: false,
        error: 'Stripe account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    // Get current account status to determine link type
    const account = await stripe.accounts.retrieve(stripeAccount.stripe_account_id);
    
    // Determine the appropriate link type
    let finalLinkType = linkType;
    if (!finalLinkType) {
      console.log(`🔍 Account type: ${stripeAccount.account_type}, details_submitted: ${account.details_submitted}, charges_enabled: ${account.charges_enabled}, payouts_enabled: ${account.payouts_enabled}`);
      
      // OAuth accounts (standard) can only use account_onboarding
      if (stripeAccount.account_type === 'standard') {
        finalLinkType = 'account_onboarding';
        console.log(`🔗 OAuth account detected, using account_onboarding`);
      } else if (!account.details_submitted) {
        finalLinkType = 'account_onboarding';
        console.log(`🔗 Details not submitted, using account_onboarding`);
      } else if (!account.charges_enabled || !account.payouts_enabled) {
        finalLinkType = 'account_update';
        console.log(`🔗 Account needs updates, using account_update`);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Account is already fully set up',
          code: 'ACCOUNT_COMPLETE'
        });
      }
    }

    // Create account link
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.chatterforms.com'
    console.log(`🔗 Using frontend URL for redirects: ${frontendUrl}`);
    console.log(`🔗 Creating ${finalLinkType} link for account: ${stripeAccount.stripe_account_id}`);
    
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccount.stripe_account_id,
      refresh_url: refreshUrl || `${frontendUrl}/settings?stripe_refresh=true`,
      return_url: returnUrl || `${frontendUrl}/settings?stripe_success=true`,
      type: finalLinkType
    });

    console.log(`✅ Account link created for account: ${stripeAccount.stripe_account_id}`);

    res.json({
      success: true,
      url: accountLink.url,
      expires_at: accountLink.expires_at,
      link_type: finalLinkType
    });

  } catch (error) {
    console.error('❌ Error creating account link:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request to Stripe',
        code: 'INVALID_REQUEST'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create account link',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get all Stripe accounts for a user
app.get('/api/stripe/accounts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`💳 Getting all Stripe accounts for user: ${userId}`);

    const accounts = await gcpClient.getStripeAccounts(userId);
    
    // Sync each account with Stripe to get latest status
    const syncedAccounts = await Promise.all(accounts.map(async (account) => {
      try {
        const stripeAccount = await stripe.accounts.retrieve(account.stripe_account_id);
        
        // Update local account data
        await gcpClient.updateStripeAccount(account.id, {
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          last_sync_at: new Date()
        });

        // Determine account status
        const isFullySetup = stripeAccount.charges_enabled && stripeAccount.payouts_enabled && stripeAccount.details_submitted;
        const needsOnboarding = !stripeAccount.details_submitted;
        const needsVerification = stripeAccount.details_submitted && !stripeAccount.charges_enabled;
        const needsPayouts = stripeAccount.charges_enabled && !stripeAccount.payouts_enabled;

        return {
          id: account.id,
          stripe_account_id: account.stripe_account_id,
          account_type: account.account_type,
          nickname: account.nickname,
          is_fully_setup: isFullySetup,
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          country: stripeAccount.country,
          default_currency: stripeAccount.default_currency,
          email: stripeAccount.email,
          needs_onboarding: needsOnboarding,
          needs_verification: needsVerification,
          needs_payouts: needsPayouts,
          can_receive_payments: stripeAccount.charges_enabled && stripeAccount.payouts_enabled,
          has_publishable_key: Boolean(account.publishable_key),
          needs_reconnect: !account.publishable_key
        };
      } catch (error) {
        console.error(`❌ Error syncing account ${account.stripe_account_id}:`, error);
        return {
          id: account.id,
          stripe_account_id: account.stripe_account_id,
          account_type: account.account_type,
          nickname: account.nickname,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
          country: account.country,
          default_currency: account.default_currency,
          email: account.email,
          has_publishable_key: Boolean(account.publishable_key),
          needs_reconnect: !account.publishable_key
        };
      }
    }));

    res.json({
      success: true,
      accounts: syncedAccounts
    });

  } catch (error) {
    console.error('❌ Error getting Stripe accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Stripe accounts',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get Stripe account status with comprehensive status checking (legacy - for backward compatibility)
app.get('/api/stripe/account/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`💳 Getting Stripe account status for user: ${userId}`);

    const stripeAccount = await gcpClient.getStripeAccount(userId);
    if (!stripeAccount) {
      return res.status(404).json({
        success: false,
        error: 'Stripe account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    // Sync with Stripe to get latest status
    const account = await stripe.accounts.retrieve(stripeAccount.stripe_account_id);
    
    // Update local account data
    await gcpClient.updateStripeAccount(stripeAccount.id, {
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      last_sync_at: new Date()
    });

    // Determine account status and required actions
    const isFullySetup = account.charges_enabled && account.payouts_enabled && account.details_submitted;
    const needsOnboarding = !account.details_submitted;
    const needsVerification = account.details_submitted && !account.charges_enabled;
    const needsPayouts = account.charges_enabled && !account.payouts_enabled;

    // Determine what link type to use
    let linkType = null;
    let actionText = null;
    
    // OAuth accounts (standard) can only use account_onboarding
    if (stripeAccount.account_type === 'standard') {
      linkType = 'account_onboarding';
      actionText = 'Complete Account Setup';
    } else if (needsOnboarding) {
      linkType = 'account_onboarding';
      actionText = 'Complete Business Profile';
    } else if (needsVerification) {
      linkType = 'account_update';
      actionText = 'Complete Verification';
    } else if (needsPayouts) {
      linkType = 'account_update';
      actionText = 'Add Bank Account';
    }

    res.json({
      success: true,
      account: {
        id: stripeAccount.id,
        stripe_account_id: stripeAccount.stripe_account_id,
        account_type: stripeAccount.account_type,
        is_fully_setup: isFullySetup,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        country: account.country,
        default_currency: account.default_currency,
        email: account.email,
        // Status indicators
        needs_onboarding: needsOnboarding,
        needs_verification: needsVerification,
        needs_payouts: needsPayouts,
        // Action details
        link_type: linkType,
        action_text: actionText,
        can_receive_payments: account.charges_enabled && account.payouts_enabled
      }
    });

  } catch (error) {
    console.error('❌ Error getting Stripe account:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid Stripe account',
        code: 'INVALID_ACCOUNT'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to get Stripe account',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Delete specific Stripe account connection
app.delete('/api/stripe/account/:userId/:accountId', async (req, res) => {
  try {
    const { userId, accountId } = req.params;
    console.log(`🗑️ Deleting Stripe account ${accountId} for user: ${userId}`);

    if (!userId || !accountId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Account ID are required',
        code: 'MISSING_PARAMETERS'
      });
    }

    // Get the specific account to verify ownership and get Stripe account ID
    const accountRef = gcpClient.collection('user_stripe_accounts').doc(accountId);
    const accountDoc = await accountRef.get();
    
    if (!accountDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Stripe account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    const accountData = accountDoc.data();
    if (accountData.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to delete this Stripe account',
        code: 'UNAUTHORIZED'
      });
    }

    // Deactivate the Stripe account (don't delete completely for compliance)
    try {
      await stripe.accounts.del(accountData.stripe_account_id);
      console.log(`✅ Stripe account deactivated: ${accountData.stripe_account_id}`);
    } catch (stripeError) {
      console.warn(`⚠️ Could not deactivate Stripe account: ${stripeError.message}`);
      // Continue with local cleanup even if Stripe deactivation fails
    }

    // Delete local account data
    const deleted = await gcpClient.deleteStripeAccount(userId, accountId);
    if (!deleted) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete local account data',
        code: 'DELETE_FAILED'
      });
    }

    console.log(`✅ Stripe account deleted: ${accountId}`);
    res.json({
      success: true,
      message: 'Stripe account disconnected successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting Stripe account:', error);
    
    // Handle specific errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid Stripe account',
        code: 'INVALID_ACCOUNT'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete Stripe account',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Create payment intent for form submission
app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    console.log('💳 Creating payment intent');
    
    const { 
      formId, 
      fieldId, 
      amount, 
      currency = 'usd',
      customerEmail,
      customerName,
      billingAddress 
    } = req.body;

    if (!formId || !fieldId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Form ID, field ID, and amount are required'
      });
    }

    // Validate amount is a positive number
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Validate currency is a valid 3-letter code
    if (!currency || typeof currency !== 'string' || currency.length !== 3) {
      return res.status(400).json({
        success: false,
        error: 'Currency must be a valid 3-letter code (e.g., usd, eur)'
      });
    }

    // Get payment field configuration
    const paymentFields = await gcpClient.getPaymentFields(formId);
    console.log('🔍 PAYMENT DEBUG - All payment fields found:', paymentFields.length);
    console.log('🔍 PAYMENT DEBUG - All payment fields details:', JSON.stringify(paymentFields, null, 2));
    
    const paymentField = paymentFields.find(field => field.field_id === fieldId);
    
    if (!paymentField) {
      console.log('🔍 PAYMENT DEBUG - Payment field not found for fieldId:', fieldId);
      console.log('🔍 PAYMENT DEBUG - Available field IDs:', paymentFields.map(f => f.field_id));
      return res.status(404).json({
        success: false,
        error: 'Payment field not found'
      });
    }

    // DEBUG: Log payment field configuration
    console.log('🔍 PAYMENT DEBUG - Form payment field configuration:');
    console.log('🔍 - Form ID:', formId);
    console.log('🔍 - Field ID:', fieldId);
    console.log('🔍 - Configured Stripe Account ID:', paymentField.stripe_account_id);
    console.log('🔍 - Amount:', paymentField.amount);
    console.log('🔍 - Currency:', paymentField.currency);
    console.log('🔍 PAYMENT DEBUG - Full payment field object:', JSON.stringify(paymentField, null, 2));

    // Create payment intent
    console.log('🔍 PAYMENT DEBUG - Creating payment intent with account:', paymentField.stripe_account_id);
    
    // Verify connected account is ready for payments
    try {
      const connectedAccount = await stripe.accounts.retrieve(
        paymentField.stripe_account_id
      );

      if (!connectedAccount.charges_enabled || !connectedAccount.payouts_enabled) {
        console.error(`❌ Connected account ${paymentField.stripe_account_id} is not ready: charges=${connectedAccount.charges_enabled}, payouts=${connectedAccount.payouts_enabled}`);
        return res.status(400).json({
          success: false,
          error: 'The merchant account is not fully set up to accept payments. Please contact the form owner.',
          code: 'ACCOUNT_NOT_READY'
        });
      }
    } catch (accError) {
      console.error('❌ Error validating connected account:', accError);
      return res.status(400).json({
        success: false,
        error: 'Invalid merchant account configuration',
        code: 'INVALID_ACCOUNT'
      });
    }

    // Create direct charge on connected account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: paymentField.amount,
      currency: paymentField.currency,
      // application_fee_amount is removed for direct pass-through
      metadata: {
        form_id: formId,
        field_id: fieldId,
        customer_email: customerEmail || '',
        customer_name: customerName || ''
      },
      ...(customerEmail && { receipt_email: customerEmail }) // Only include if provided
    }, {
      stripeAccount: paymentField.stripe_account_id // Direct charge
    });

    console.log(`✅ Payment intent created: ${paymentIntent.id}`);

    res.json({
      success: true,
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    });

  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    
    // Provide more specific error information
    let errorMessage = 'Failed to create payment intent';
    let statusCode = 500;
    
    if (error.type === 'StripeInvalidRequestError') {
      errorMessage = `Invalid request: ${error.message}`;
      statusCode = 400;
    } else if (error.type === 'StripeCardError') {
      errorMessage = `Card error: ${error.message}`;
      statusCode = 400;
    } else if (error.type === 'StripeRateLimitError') {
      errorMessage = 'Rate limit exceeded. Please try again later.';
      statusCode = 429;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: error.message
    });
  }
});

// Handle successful payment
app.post('/api/stripe/payment-success', async (req, res) => {
  try {
    console.log('✅ Payment success webhook received');
    
    const { 
      submissionId, 
      formId, 
      fieldId, 
      paymentIntentId,
      customerEmail,
      customerName,
      billingAddress 
    } = req.body;

    if (!submissionId || !formId || !fieldId || !paymentIntentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    // Get payment intent details from Stripe
    // Must retrieve from the connected account that processed the charge
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {
        stripeAccount: paymentField.stripe_account_id
      }
    );
    
    // Get payment field to get Stripe account ID
    const paymentFields = await gcpClient.getPaymentFields(formId);
    const paymentField = paymentFields.find(field => field.field_id === fieldId);
    
    if (!paymentField) {
      return res.status(404).json({
        success: false,
        error: 'Payment field not found'
      });
    }

    // Store payment transaction
    const transactionId = await gcpClient.storePaymentTransaction(
      submissionId,
      formId,
      fieldId,
      {
        paymentIntentId: paymentIntent.id,
        stripeAccountId: paymentField.stripe_account_id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: 'succeeded',
        customerEmail: customerEmail || paymentIntent.receipt_email,
        customerName: customerName,
        billingAddress: billingAddress,
        paymentMethod: paymentIntent.payment_method ? {
          type: paymentIntent.payment_method.type,
          brand: paymentIntent.payment_method.card?.brand,
          last4: paymentIntent.payment_method.card?.last4,
          exp_month: paymentIntent.payment_method.card?.exp_month,
          exp_year: paymentIntent.payment_method.card?.exp_year
        } : null,
        receiptUrl: paymentIntent.charges?.data?.[0]?.receipt_url,
        completedAt: new Date()
      }
    );

    console.log(`✅ Payment transaction stored: ${transactionId}`);

    res.json({
      success: true,
      transactionId: transactionId,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: 'succeeded'
    });

  } catch (error) {
    console.error('❌ Error processing payment success:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process payment success'
    });
  }
});

// Get payment transactions for a submission
app.get('/api/stripe/transactions/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;
    console.log(`💳 Getting payment transactions for submission: ${submissionId}`);

    const transactions = await gcpClient.getPaymentTransactions(submissionId);
    
    // Remove sensitive information before sending to frontend
    const safeTransactions = transactions.map(transaction => ({
      id: transaction.id,
      field_id: transaction.field_id,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      customer_email: transaction.customer_email,
      customer_name: transaction.customer_name,
      created_at: transaction.created_at,
      completed_at: transaction.completed_at,
      receipt_url: transaction.receipt_url
    }));

    res.json({
      success: true,
      transactions: safeTransactions
    });

  } catch (error) {
    console.error('❌ Error getting payment transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment transactions'
    });
  }
});

// Update payment field configuration
app.put('/api/stripe/payment-field/:formId/:fieldId', async (req, res) => {
  try {
    console.log('💳 Updating payment field configuration');
    
    const { formId, fieldId } = req.params;
    const { stripeAccountId, amount, currency, description, productName } = req.body;
    
    // DEBUG: Log the update request
    console.log('🔍 PAYMENT FIELD UPDATE DEBUG:');
    console.log('🔍 - Form ID:', formId);
    console.log('🔍 - Field ID:', fieldId);
    console.log('🔍 - New Stripe Account ID:', stripeAccountId);
    console.log('🔍 - Amount:', amount);
    console.log('🔍 - Currency:', currency);
    console.log('🔍 - Description:', description);
    console.log('🔍 - Product Name:', productName);
    
    if (!formId || !fieldId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID and field ID are required'
      });
    }

    const updates = {};
    if (stripeAccountId !== undefined) updates.stripe_account_id = stripeAccountId;
    if (amount !== undefined) updates.amount = Math.round(amount * 100); // Convert to cents
    if (currency !== undefined) updates.currency = currency;
    if (description !== undefined) updates.description = description;
    if (productName !== undefined) updates.product_name = productName;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No updates provided'
      });
    }

    console.log('🔍 PAYMENT FIELD UPDATE DEBUG - Updates to apply:', updates);
    await gcpClient.updatePaymentField(formId, fieldId, updates);
    
    console.log(`✅ Payment field updated: ${formId}/${fieldId}`);
    
    res.json({
      success: true,
      message: 'Payment field updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating payment field:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment field'
    });
  }
});

// Stripe webhook handler for payment events
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Enhanced logging for webhook debugging
    console.log('🔍 Webhook Debug - Endpoint: /api/stripe/webhook');
    console.log('🔍 Webhook Debug - Signature header present:', !!sig);
    console.log('🔍 Webhook Debug - Webhook secret configured:', !!endpointSecret);
    console.log('🔍 Webhook Debug - Request body type:', typeof req.body);
    console.log('🔍 Webhook Debug - Request body length:', req.body?.length || 0);

    if (!endpointSecret) {
      console.error('❌ Stripe webhook secret not configured');
      return res.status(400).json({ error: 'Webhook secret not configured' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      console.error('🔍 Webhook Debug - Error details:', {
        endpoint: '/api/stripe/webhook',
        hasSignature: !!sig,
        hasSecret: !!endpointSecret,
        bodyType: typeof req.body,
        bodyLength: req.body?.length || 0,
        errorType: err.constructor.name
      });
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    console.log(`🔔 Stripe webhook received: ${event.type}`);
    console.log(`🔍 Webhook Debug - Event ID: ${event.id}`);

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
      case 'account.updated':
        await handleAccountUpdate(event.data.object);
        break;
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('❌ Error processing Stripe webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Helper function to handle successful payments
async function handlePaymentSuccess(paymentIntent) {
  try {
    console.log(`✅ Payment succeeded: ${paymentIntent.id}`);
    
    // Find the transaction by payment intent ID
    const transaction = await gcpClient.getPaymentTransactionByIntentId(paymentIntent.id);
    
    if (transaction) {
      // Update transaction status
      await gcpClient.updatePaymentTransaction(transaction.id, {
        status: 'succeeded',
        completed_at: new Date(),
        receipt_url: paymentIntent.charges?.data?.[0]?.receipt_url
      });
      
      console.log(`✅ Transaction updated: ${transaction.id}`);
    } else {
      console.log(`⚠️ No transaction found for payment intent: ${paymentIntent.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment success:', error);
  }
}

// Helper function to handle failed payments
async function handlePaymentFailure(paymentIntent) {
  try {
    console.log(`❌ Payment failed: ${paymentIntent.id}`);
    
    // Find the transaction by payment intent ID
    const transaction = await gcpClient.getPaymentTransactionByIntentId(paymentIntent.id);
    
    if (transaction) {
      // Update transaction status
      await gcpClient.updatePaymentTransaction(transaction.id, {
        status: 'failed',
        failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed'
      });
      
      console.log(`❌ Transaction updated: ${transaction.id}`);
    } else {
      console.log(`⚠️ No transaction found for payment intent: ${paymentIntent.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment failure:', error);
  }
}

// Helper function to handle account updates
async function handleAccountUpdate(account) {
  try {
    console.log(`🔄 Account updated: ${account.id}`);
    
    // Find the local account record
    const localAccount = await gcpClient.getStripeAccount(account.id);
    
    if (localAccount) {
      // Update local account data
      await gcpClient.updateStripeAccount(localAccount.id, {
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        last_sync_at: new Date()
      });
      
      console.log(`🔄 Account data updated: ${localAccount.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling account update:', error);
  }
}

// ========================================
// CALENDLY INTEGRATION ENDPOINTS
// ========================================

/**
 * Connect Calendly account
 */
app.post('/api/calendly/connect', async (req, res) => {
  try {
    console.log('📅 Connecting Calendly account');
    
    const { userId, calendlyUrl } = req.body;

    if (!userId || !calendlyUrl) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Calendly URL are required'
      });
    }

    // Validate Calendly URL format
    if (!calendlyUrl.includes('calendly.com/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Calendly URL format'
      });
    }

    // Extract username from URL for storage
    const urlParts = calendlyUrl.split('/');
    const calendlyUsername = urlParts[urlParts.length - 1] || 'unknown';
    
    // Store Calendly account
    const accountId = await gcpClient.storeCalendlyAccount(
      userId,
      calendlyUsername,
      calendlyUrl,
      [] // Event types will be fetched separately
    );

    console.log(`✅ Calendly account connected: ${accountId}`);

    res.json({
      success: true,
      accountId,
      message: 'Calendly account connected successfully'
    });

  } catch (error) {
    console.error('❌ Error connecting Calendly account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect Calendly account'
    });
  }
});

/**
 * Get Calendly account status
 */
app.get('/api/calendly/account/:userId', async (req, res) => {
  try {
    console.log(`📅 Getting Calendly account status for user: ${req.params.userId}`);
    
    const accounts = await gcpClient.getCalendlyAccounts(req.params.userId);
    
    res.json({
      success: true,
      accounts: accounts || []
    });

  } catch (error) {
    console.error('❌ Error getting Calendly account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Calendly account'
    });
  }
});

// Delete Calendly URL for a user
app.delete('/api/calendly/account/:userId/:accountId', async (req, res) => {
  try {
    const { userId, accountId } = req.params;
    console.log(`🗑️ Request to delete Calendly account ${accountId} for user ${userId}`);
    const result = await gcpClient.deleteCalendlyAccount(userId, accountId);
    if (!result.success) {
      if (result.reason === 'not_found') return res.status(404).json({ success: false, error: 'Calendly URL not found' });
      if (result.reason === 'forbidden') return res.status(403).json({ success: false, error: 'Forbidden' });
      return res.status(500).json({ success: false, error: 'Failed to delete Calendly URL' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting Calendly URL:', error);
    res.status(500).json({ success: false, error: 'Failed to delete Calendly URL' });
  }
});

/**
 * Get Calendly event types
 */
app.get('/api/calendly/event-types/:userId', async (req, res) => {
  try {
    console.log(`📅 Getting Calendly event types for user: ${req.params.userId}`);
    
    const account = await gcpClient.getCalendlyAccount(req.params.userId);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Calendly account not found'
      });
    }

    // For now, return basic event types
    // In the future, we can integrate with Calendly API to fetch real event types
    const eventTypes = [
      {
        uri: `${account.calendly_url}/15min`,
        name: '15 Minute Meeting',
        duration: 15,
        description: 'Quick 15-minute call',
        color: '#0066cc',
        active: true
      },
      {
        uri: `${account.calendly_url}/30min`,
        name: '30 Minute Meeting',
        duration: 30,
        description: 'Standard 30-minute meeting',
        color: '#0066cc',
        active: true
      },
      {
        uri: `${account.calendly_url}/60min`,
        name: '1 Hour Meeting',
        duration: 60,
        description: '1-hour detailed discussion',
        color: '#0066cc',
        active: true
      }
    ];

    res.json({
      success: true,
      eventTypes
    });

  } catch (error) {
    console.error('❌ Error getting Calendly event types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Calendly event types'
    });
  }
});

/**
 * Store calendar booking
 */
app.post('/api/calendly/booking', async (req, res) => {
  try {
    console.log('📅 Storing calendar booking');
    
    const { 
      submissionId, 
      formId, 
      fieldId, 
      eventUri, 
      eventName, 
      startTime, 
      endTime, 
      duration, 
      timezone, 
      attendeeEmail, 
      attendeeName, 
      attendeePhone, 
      bookingUrl 
    } = req.body;

    // Validate required fields
    if (!submissionId || !formId || !fieldId || !eventUri) {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking data: submissionId, formId, fieldId, and eventUri are required'
      });
    }

    // Validate optional but important fields - allow fallback values
    if (!eventName || eventName.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking details: eventName is required'
      });
    }

    // Validate duration is a positive number
    if (duration && (typeof duration !== 'number' || duration <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'Duration must be a positive number'
      });
    }

    // Validate email format if provided
    if (attendeeEmail && !attendeeEmail.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid attendee email format'
      });
    }

    const bookingData = {
      eventUri,
      eventName,
      startTime,
      endTime,
      duration,
      timezone,
      attendeeEmail,
      attendeeName,
      attendeePhone,
      bookingUrl
    };

    const bookingId = await gcpClient.storeCalendarBooking(
      submissionId,
      formId,
      fieldId,
      bookingData
    );

    console.log(`✅ Calendar booking stored: ${bookingId}`);

    res.json({
      success: true,
      bookingId,
      message: 'Calendar booking stored successfully'
    });

  } catch (error) {
    console.error('❌ Error storing calendar booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store calendar booking'
    });
  }
});

/**
 * Get calendar bookings for a submission
 */
app.get('/api/calendly/bookings/:submissionId', async (req, res) => {
  try {
    console.log(`📅 Getting calendar bookings for submission: ${req.params.submissionId}`);
    
    const bookings = await gcpClient.getCalendarBookings(req.params.submissionId);

    res.json({
      success: true,
      bookings
    });

  } catch (error) {
    console.error('❌ Error getting calendar bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get calendar bookings'
    });
  }
});

// ============== ANONYMOUS FORM STORAGE ENDPOINT ==============

/**
 * Store anonymous form with full response data for migration
 */
app.post('/store-anonymous-form', async (req, res) => {
  try {
    const { formData, userId, metadata } = req.body;

    if (!formData) {
      return res.status(400).json({
        success: false,
        error: 'Form data is required'
      });
    }

    console.log('📝 Storing anonymous form structure in GCP...');
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Use the form ID from the form data, or generate a new one
    const formId = formData.id || formData.formId || `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store form structure
    console.log(`📝 Attempting to store anonymous form in Firestore: ${formId}`);
    console.log(`📝 Form data:`, JSON.stringify(formData, null, 2));
    
    const result = await gcpClient.storeFormStructure(
      formId,
      formData,
      userId || 'anonymous',
      {
        ...metadata,
        source: 'railway-backend-anonymous',
        isHipaa: metadata?.isHipaa || false,
        isPublished: metadata?.isPublished || false,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip || req.connection.remoteAddress
      }
    );

    console.log(`✅ Anonymous form structure stored: ${formId}`);
    console.log(`✅ Storage result:`, JSON.stringify(result, null, 2));

    // Return the FULL response from GCP client for migration purposes
    res.json({
      success: true,
      formId: result.formId,
      userId: result.userId,
      isAnonymous: result.isAnonymous,
      anonymousSessionId: result.anonymousSessionId,
      isUpdate: result.isUpdate,
      message: 'Anonymous form structure stored successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Anonymous form storage error:', error);
    res.status(500).json({
      success: false,
      error: 'Anonymous form storage failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANONYMOUS SESSION ENDPOINT ==============

/**
 * Create anonymous session for anonymous users
 */
app.post('/api/auth/anonymous-session', async (req, res) => {
  try {
    console.log('🎯 Creating anonymous session...');
    
    // Generate a unique session ID
    const sessionId = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create anonymous session in Firestore
    await gcpClient.createAnonymousSession(
      sessionId,
      req.get('User-Agent') || 'unknown',
      req.ip || req.connection.remoteAddress || 'unknown'
    );
    
    console.log(`✅ Anonymous session created: ${sessionId}`);
    
    res.json({
      success: true,
      sessionId,
      message: 'Anonymous session created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating anonymous session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create anonymous session'
    });
  }
});

// ============== ONBOARDING API ENDPOINTS ==============

/**
 * Initialize onboarding progress for a user
 */
app.post('/api/onboarding/initialize', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    console.log(`🎯 Initializing onboarding for user: ${userId}`);
    
    const progress = await gcpClient.initializeOnboardingProgress(userId);
    
    res.json({
      success: true,
      progress
    });

  } catch (error) {
    console.error('❌ Error initializing onboarding:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize onboarding'
    });
  }
});

/**
 * Get user's onboarding progress
 */
app.get('/api/onboarding/progress/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`📊 Getting onboarding progress for user: ${userId}`);
    
    const progress = await gcpClient.getOnboardingProgress(userId);
    
    res.json({
      success: true,
      progress
    });

  } catch (error) {
    console.error('❌ Error getting onboarding progress:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get onboarding progress'
    });
  }
});

/**
 * Update onboarding progress when a task is completed
 */
app.post('/api/onboarding/complete-task', async (req, res) => {
  try {
    const { userId, taskId, taskName, level, reward } = req.body;
    
    if (!userId || !taskId || !taskName || !level) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, taskId, taskName, level'
      });
    }

    console.log(`🎯 Completing task ${taskId} for user: ${userId}`);
    
    const progress = await gcpClient.updateOnboardingProgress(
      userId, 
      taskId, 
      taskName, 
      level, 
      reward || `Task completed: ${taskName}`
    );
    
    res.json({
      success: true,
      progress
    });

  } catch (error) {
    console.error('❌ Error completing onboarding task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete onboarding task'
    });
  }
});

/**
 * Get help article by task ID
 */
app.get('/api/onboarding/help/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    console.log(`📚 Getting help article for task: ${taskId}`);
    
    const helpArticle = await gcpClient.getHelpArticle(taskId);
    
    res.json({
      success: true,
      helpArticle
    });

  } catch (error) {
    console.error('❌ Error getting help article:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get help article'
    });
  }
});

/**
 * Create or update help article
 */
app.post('/api/onboarding/help', async (req, res) => {
  try {
    const { taskId, title, content, steps, tips, related } = req.body;
    
    if (!taskId || !title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: taskId, title, content'
      });
    }

    console.log(`📚 Upserting help article for task: ${taskId}`);
    
    await gcpClient.upsertHelpArticle(taskId, {
      title,
      content,
      steps: steps || [],
      tips: tips || [],
      related: related || []
    });
    
    res.json({
      success: true,
      message: 'Help article saved successfully'
    });

  } catch (error) {
    console.error('❌ Error saving help article:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save help article'
    });
  }
});

/**
 * Get onboarding analytics for a user
 */
app.get('/api/onboarding/analytics/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`📊 Getting onboarding analytics for user: ${userId}`);
    
    const analytics = await gcpClient.getOnboardingAnalytics(userId);
    
    res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('❌ Error getting onboarding analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get onboarding analytics'
    });
  }
});

/**
 * Correct user's onboarding level based on actual completed tasks
 */
app.post('/api/onboarding/correct-level', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    console.log(`🔧 Correcting onboarding level for user: ${userId}`);
    
    const result = await gcpClient.correctOnboardingLevel(userId);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('❌ Error correcting onboarding level:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to correct onboarding level'
    });
  }
});

/**
 * Force fix onboarding completion status
 */
app.post('/api/onboarding/force-fix-completion', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }
    
    console.log('🔧 Force fixing onboarding completion for user:', userId);
    
    // Get current progress
    const progress = await gcpClient.getOnboardingProgress(userId);
    if (!progress) {
      return res.status(404).json({ success: false, error: 'No progress found' });
    }
    
    console.log('📊 Current completed tasks:', progress.completedTasks);
    console.log('📊 Current completedAt:', progress.completedAt);
    
    // Check if all tasks are actually completed
    const allTasks = [
      // Level 1
      'create-form', 'publish-form',
      // Level 2
      'ai-modify-fields', 'global-settings', 'change-field-names', 'upload-logo', 'republish',
      // Level 3
      'customize-fields', 'move-fields', 'add-fields-preview', 'delete-fields-preview',
      // Level 4
      'go-to-workspace', 'submit-and-check-submissions', 'clone-form', 'delete-form',
      // Level 5
      'setup-calendly', 'setup-esignature', 'setup-stripe', 'setup-hipaa'
    ];
    
    const missingTasks = allTasks.filter(taskId => !progress.completedTasks.includes(taskId));
    console.log('❌ Missing tasks:', missingTasks);
    
    if (missingTasks.length > 0 && progress.completedAt) {
      console.log('🔧 Removing incorrect completedAt flag...');
      
      // Remove completedAt flag
      delete progress.completedAt;
      progress.lastUpdated = new Date();
      
      // Recalculate total progress
      progress.totalProgress = Math.round((progress.completedTasks.length / allTasks.length) * 100);
      
      // Update in database
      const userRef = gcpClient.collection('users').doc(userId);
      await userRef.update({
        onboardingProgress: progress
      });
      
      console.log('✅ Fixed! Removed completedAt flag. New progress:', progress.totalProgress + '%');
      
      res.json({
        success: true,
        message: 'Fixed onboarding completion status',
        missingTasks,
        newProgress: progress.totalProgress,
        removedCompletedAt: true
      });
    } else if (missingTasks.length === 0) {
      res.json({
        success: true,
        message: 'All tasks completed, onboarding should be marked as completed',
        missingTasks: [],
        newProgress: progress.totalProgress
      });
    } else {
      res.json({
        success: true,
        message: 'No completedAt flag to remove',
        missingTasks,
        newProgress: progress.totalProgress
      });
    }
    
  } catch (error) {
    console.error('Error force fixing onboarding completion:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Log onboarding event (for analytics)
 */
app.post('/api/onboarding/log-event', async (req, res) => {
  try {
    const { userId, event, taskId, level, metadata } = req.body;
    
    if (!userId || !event) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, event'
      });
    }

    console.log(`📊 Logging onboarding event: ${event} for user: ${userId}`);
    
    await gcpClient.logOnboardingEvent(userId, event, taskId, level, metadata || {});
    
    res.json({
      success: true,
      message: 'Event logged successfully'
    });

  } catch (error) {
    console.error('❌ Error logging onboarding event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to log onboarding event'
    });
  }
});

/**
 * Update user onboarding flags
 */
app.post('/api/user/update-onboarding-flags', async (req, res) => {
  try {
    const { userId, flags } = req.body;
    
    if (!userId || !flags) {
      return res.status(400).json({
        success: false,
        error: 'User ID and flags are required'
      });
    }

    console.log(`🏁 Updating onboarding flags for user: ${userId}`, flags);
    
    const result = await gcpClient.updateUserOnboardingFlags(userId, flags);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('❌ Error updating user onboarding flags:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user onboarding flags'
    });
  }
});

// ============== SERVER STARTUP ==============

app.listen(PORT, () => {
  console.log(`🚀 ChatterForms API running at ${BASE_URL}`);
  console.log(`📁 PDF Upload: POST ${BASE_URL}/upload`);
  console.log(`📸 Screenshot: POST ${BASE_URL}/screenshot`);
  console.log(`📎 File Upload: POST ${BASE_URL}/upload-file`);
  console.log(`📋 Form Submissions: GET ${BASE_URL}/form/:formId/submissions`);
  console.log(`📄 Single Submission: GET ${BASE_URL}/submission/:submissionId`);
  console.log(`📊 Form Analytics: GET ${BASE_URL}/analytics/:formId`);
  console.log(`👤 User Analytics: GET ${BASE_URL}/analytics/user/:userId`);
  console.log(`📈 All Analytics: GET ${BASE_URL}/analytics?limit=100`);
  console.log(`🗑️ Cleanup: GET ${BASE_URL}/cleanup`);
  console.log(`🔄 Form Migration: POST ${BASE_URL}/api/forms/migrate-anonymous`);
  console.log(`🧹 Session Cleanup: GET ${BASE_URL}/api/cleanup/expired-sessions`);
  console.log(`🔐 Auth Signup: POST ${BASE_URL}/auth/signup`);
  console.log(`🔑 Auth Login: POST ${BASE_URL}/auth/login`);
  console.log(`✅ Email Verify: POST ${BASE_URL}/auth/verify-email`);
  console.log(`🔄 Password Reset: POST ${BASE_URL}/auth/request-reset`);
  console.log(`🔒 Reset Password: POST ${BASE_URL}/auth/reset-password`);
  console.log(`📦 Form Migration: POST ${BASE_URL}/auth/migrate-forms`);
  console.log(`👤 Session Check: GET ${BASE_URL}/auth/session`);
  console.log(`💳 Stripe Webhooks: POST ${BASE_URL}/api/billing/webhook`);
  console.log(`📧 Form Published Email: POST ${BASE_URL}/api/emails/send-form-published`);
  console.log(`📧 Form Submission Email: POST ${BASE_URL}/api/emails/send-form-submission`);
  console.log(`📧 Form Deleted Email: POST ${BASE_URL}/api/emails/send-form-deleted`);
  console.log(`🎯 Onboarding Initialize: POST ${BASE_URL}/api/onboarding/initialize`);
  console.log(`📊 Onboarding Progress: GET ${BASE_URL}/api/onboarding/progress/:userId`);
  console.log(`✅ Complete Task: POST ${BASE_URL}/api/onboarding/complete-task`);
  console.log(`📚 Help Article: GET ${BASE_URL}/api/onboarding/help/:taskId`);
  console.log(`📈 Onboarding Analytics: GET ${BASE_URL}/api/onboarding/analytics/:userId`);
  console.log(`🏥 Health: GET ${BASE_URL}/health`);
  
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`🚄 Running on Railway: ${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  } else {
    console.log(`💻 Running locally on port ${PORT}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});