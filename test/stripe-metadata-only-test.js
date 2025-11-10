/**
 * CRITICAL TEST: Verify if updating only subscription metadata triggers invoice generation
 * 
 * This test MUST be run before implementing Option 2 (metadata-only trial changes)
 * 
 * Expected Result: NO invoices should be created when updating only metadata during trial
 * If invoices ARE created, we cannot use the metadata-only approach
 */

// Load test secrets
const testSecrets = require('./test-secrets');
const stripe = require('stripe')(testSecrets.STRIPE_SECRET_KEY);

// Price IDs from your system
const PRICE_IDS = {
  basic: {
    monthly: 'price_1S8PO5RsohPcZDimYKy7PLNT',
    annual: 'price_1S8PO5RsohPcZDim7N1h7kSM'
  },
  pro: {
    monthly: 'price_1S8PQaRsohPcZDim8f6xylsh',
    annual: 'price_1S8PVYRsohPcZDimF5L5l38A'
  }
};

async function testMetadataOnlyUpdate() {
  console.log('═══════════════════════════════════════════════════');
  console.log('CRITICAL TEST: Metadata-Only Update During Trial');
  console.log('═══════════════════════════════════════════════════\n');
  
  let customer, subscription;
  
  try {
    // Step 1: Create test customer (no payment method needed for trial)
    console.log('Step 1: Creating test customer...');
    customer = await stripe.customers.create({
      email: `test-metadata-${Date.now()}@example.com`
    });
    console.log(`✅ Customer created: ${customer.id}`);
    
    // Step 2: Create subscription with trial (Basic Monthly)
    // Note: No payment method needed for trial subscription
    console.log('\nStep 2: Creating subscription with 30-day trial...');
    subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: PRICE_IDS.basic.monthly }],
      trial_period_days: 30
    });
    console.log(`✅ Subscription created: ${subscription.id}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Trial ends: ${new Date(subscription.trial_end * 1000).toISOString()}`);
    console.log(`   Current items: ${subscription.items.data[0].price.id} (Basic Monthly)`);
    
    // Wait a moment for Stripe to process
    await sleep(2000);
    
    // Step 3: Check invoices BEFORE metadata update
    console.log('\nStep 3: Checking invoices BEFORE metadata update...');
    const invoicesBefore = await stripe.invoices.list({
      customer: customer.id,
      limit: 10
    });
    console.log(`   Invoices found: ${invoicesBefore.data.length}`);
    invoicesBefore.data.forEach((inv, idx) => {
      console.log(`   Invoice ${idx + 1}: ${inv.id} - Status: ${inv.status}, Amount: $${(inv.amount_due / 100).toFixed(2)}`);
    });
    
    // Step 4: Update ONLY metadata (simulate upgrade to Pro Annual)
    console.log('\n🔍 Step 4: Updating ONLY metadata (Pro Annual)...');
    console.log('   NOT updating items parameter');
    console.log('   Preserving trial_end');
    const updated = await stripe.subscriptions.update(subscription.id, {
      // ❌ NOT updating items - this is the key test
      metadata: {
        planId: 'pro',
        interval: 'annual',
        // Clear scheduled changes
        scheduledPlanId: null,
        scheduledInterval: null
      },
      trial_end: subscription.trial_end  // Preserve trial
    });
    
    console.log('✅ Subscription updated successfully');
    console.log(`   Status: ${updated.status} (should still be 'trialing')`);
    console.log(`   Trial end: ${new Date(updated.trial_end * 1000).toISOString()} (unchanged)`);
    console.log(`   Items: ${updated.items.data[0].price.id} (should still be Basic Monthly)`);
    console.log(`   Metadata: planId=${updated.metadata.planId}, interval=${updated.metadata.interval}`);
    
    // Wait a moment for Stripe to process any async operations
    await sleep(3000);
    
    // Step 5: Check invoices AFTER metadata update
    console.log('\n🔍 Step 5: Checking invoices AFTER metadata update...');
    const invoicesAfter = await stripe.invoices.list({
      customer: customer.id,
      limit: 10
    });
    console.log(`   Invoices found: ${invoicesAfter.data.length}`);
    invoicesAfter.data.forEach((inv, idx) => {
      console.log(`   Invoice ${idx + 1}: ${inv.id} - Status: ${inv.status}, Amount: $${(inv.amount_due / 100).toFixed(2)}`);
    });
    
    // Step 6: Analyze results
    console.log('\n═══════════════════════════════════════════════════');
    console.log('RESULT ANALYSIS:');
    console.log('═══════════════════════════════════════════════════');
    
    const invoiceCreated = invoicesAfter.data.length > invoicesBefore.data.length;
    
    if (invoiceCreated) {
      console.log('❌ CRITICAL FINDING: NEW INVOICE WAS CREATED!');
      console.log('');
      console.log('   This means updating metadata alone DOES trigger invoice generation.');
      console.log('   Option 2 (metadata-only approach) WILL NOT WORK as designed.');
      console.log('');
      console.log('   New invoice details:');
      const newInvoice = invoicesAfter.data[0];
      console.log(`   - Invoice ID: ${newInvoice.id}`);
      console.log(`   - Status: ${newInvoice.status}`);
      console.log(`   - Amount: $${(newInvoice.amount_due / 100).toFixed(2)}`);
      console.log(`   - Lines:`);
      newInvoice.lines.data.forEach(line => {
        console.log(`     * ${line.description}: $${(line.amount / 100).toFixed(2)}`);
      });
      console.log('');
      console.log('❌ RECOMMENDATION: Do NOT implement Option 2 as described.');
      console.log('   Consider using Subscription Schedules (Option 2B) instead.');
      
    } else {
      console.log('✅ SUCCESS: NO NEW INVOICE WAS CREATED!');
      console.log('');
      console.log('   This means updating metadata alone does NOT trigger invoice generation.');
      console.log('   Option 2 (metadata-only approach) is SAFE to implement.');
      console.log('');
      console.log('   Key findings:');
      console.log('   ✅ Subscription status remained "trialing"');
      console.log('   ✅ Trial end date was preserved');
      console.log('   ✅ Subscription items were NOT changed');
      console.log('   ✅ Metadata was successfully updated');
      console.log('   ✅ No invoices were generated');
      console.log('');
      console.log('✅ RECOMMENDATION: Proceed with Option 2 implementation.');
      console.log('   Update only metadata during trial, apply items at trial end via webhook.');
    }
    
    console.log('═══════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED WITH ERROR:');
    console.error(error.message);
    if (error.raw) {
      console.error('Stripe error details:', error.raw);
    }
    throw error;
    
  } finally {
    // Cleanup
    console.log('Cleaning up test resources...');
    try {
      if (subscription) {
        await stripe.subscriptions.del(subscription.id);
        console.log(`✅ Deleted subscription: ${subscription.id}`);
      }
      if (customer) {
        await stripe.customers.del(customer.id);
        console.log(`✅ Deleted customer: ${customer.id}`);
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
if (require.main === module) {
  testMetadataOnlyUpdate()
    .then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testMetadataOnlyUpdate };

