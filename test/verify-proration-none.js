/**
 * VERIFICATION TEST: Direct Item Update + proration_behavior: 'none'
 * 
 * Purpose: Verify that updating subscription items during trial with
 * proration_behavior: 'none' prevents charges while updating the subscription.
 * 
 * Test Flow:
 * 1. Create trial subscription (Basic Monthly)
 * 2. Upgrade to Pro Monthly with proration_behavior: 'none'
 * 3. Verify: Zero charges
 * 4. Verify: Stripe shows Pro (not Basic)
 * 5. Verify: Invoice preview shows Pro price ($39.99)
 * 6. Verify: Trial end preserved
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || require('../test/test-secrets').STRIPE_SECRET_KEY);

// Price IDs
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

async function verifyProrationNone() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('VERIFICATION TEST: Direct Update + proration_behavior: none');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  let customer, subscription;
  
  try {
    // ===================================================================
    // STEP 1: Create Trial Subscription (Basic Monthly)
    // ===================================================================
    console.log('📝 STEP 1: Creating trial subscription (Basic Monthly)...\n');
    
    customer = await stripe.customers.create({
      email: `test-proration-${Date.now()}@example.com`,
      payment_method: 'pm_card_visa',
      invoice_settings: { 
        default_payment_method: 'pm_card_visa' 
      },
      metadata: {
        test: 'proration-none-verification'
      }
    });
    console.log('✅ Customer created:', customer.id);
    
    subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ 
        price: PRICE_IDS.basic.monthly 
      }],
      trial_period_days: 30,
      metadata: { 
        userId: 'test-user',
        planId: 'basic',
        interval: 'monthly'
      }
    });
    
    console.log('✅ Subscription created:', subscription.id);
    console.log('   Status:', subscription.status);
    console.log('   Trial end:', new Date(subscription.trial_end * 1000).toISOString());
    console.log('   Current price:', subscription.items.data[0].price.id);
    
    // Get product name
    const initialProduct = await stripe.products.retrieve(subscription.items.data[0].price.product);
    console.log('   Product name:', initialProduct.name);
    
    // Get initial invoices
    await new Promise(resolve => setTimeout(resolve, 2000));
    const initialInvoices = await stripe.invoices.list({
      customer: customer.id,
      limit: 10
    });
    
    const initialCharges = initialInvoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0) / 100;
    console.log('   Initial invoices:', initialInvoices.data.length);
    console.log('   Initial charges:', `$${initialCharges.toFixed(2)}`);
    
    // ===================================================================
    // STEP 2: Upgrade to Pro Monthly with proration_behavior: 'none'
    // ===================================================================
    console.log('\n📝 STEP 2: Upgrading to Pro Monthly (proration_behavior: none)...\n');
    
    const trialEnd = subscription.trial_end;
    
    const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      items: [{
        id: subscription.items.data[0].id,
        price: PRICE_IDS.pro.monthly  // ← Update to Pro
      }],
      proration_behavior: 'none',     // ← KEY: Prevents charges
      trial_end: trialEnd,             // ← KEY: Preserves trial
      metadata: {
        userId: 'test-user',
        planId: 'pro',                 // ← Update metadata
        interval: 'monthly'
      }
    });
    
    console.log('✅ Subscription updated:', updatedSubscription.id);
    console.log('   Status:', updatedSubscription.status);
    console.log('   Trial end:', new Date(updatedSubscription.trial_end * 1000).toISOString());
    console.log('   Current price:', updatedSubscription.items.data[0].price.id);
    
    // Get product name after update
    const updatedProduct = await stripe.products.retrieve(updatedSubscription.items.data[0].price.product);
    console.log('   Product name:', updatedProduct.name);
    
    // ===================================================================
    // STEP 3: Verify Zero Charges
    // ===================================================================
    console.log('\n📝 STEP 3: Verifying charges...\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for Stripe
    
    const afterInvoices = await stripe.invoices.list({
      customer: customer.id,
      limit: 10
    });
    
    const totalCharges = afterInvoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0) / 100;
    const newInvoices = afterInvoices.data.length - initialInvoices.data.length;
    
    console.log('   Total invoices:', afterInvoices.data.length);
    console.log('   New invoices:', newInvoices);
    console.log('\n   Invoice details:');
    
    afterInvoices.data.slice(0, 3).forEach((invoice, i) => {
      console.log(`   [${i + 1}] ${invoice.id}:`);
      console.log(`       Status: ${invoice.status}`);
      console.log(`       Amount due: $${(invoice.amount_due / 100).toFixed(2)}`);
      console.log(`       Amount paid: $${(invoice.amount_paid / 100).toFixed(2)}`);
      console.log(`       Total: $${(invoice.total / 100).toFixed(2)}`);
    });
    
    console.log(`\n   Total charged: $${totalCharges.toFixed(2)}`);
    
    // ===================================================================
    // STEP 4: Verify Invoice Preview
    // ===================================================================
    console.log('\n📝 STEP 4: Verifying upcoming invoice...\n');
    
    const upcomingInvoice = await stripe.invoices.retrieveUpcoming({
      customer: customer.id
    });
    
    const upcomingAmount = upcomingInvoice.amount_due / 100;
    const upcomingDate = new Date(upcomingInvoice.period_end * 1000);
    
    console.log('   Upcoming amount:', `$${upcomingAmount.toFixed(2)}`);
    console.log('   Upcoming date:', upcomingDate.toISOString());
    console.log('   Expected Pro price: $39.99');
    
    // ===================================================================
    // STEP 5: Results Summary
    // ===================================================================
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('TEST RESULTS:');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const results = {
      trialPreserved: updatedSubscription.trial_end === trialEnd,
      zeroCharges: totalCharges === 0,
      stripeShowsPro: updatedProduct.name.includes('Pro'),
      invoicePreviewCorrect: Math.abs(upcomingAmount - 39.99) < 0.01,
      zeroInvoicesCreated: newInvoices
    };
    
    console.log('✅ Trial preserved:', results.trialPreserved ? 'YES ✅' : 'NO ❌');
    console.log('   Original:', new Date(trialEnd * 1000).toISOString());
    console.log('   After update:', new Date(updatedSubscription.trial_end * 1000).toISOString());
    
    console.log('\n✅ Zero charges:', results.zeroCharges ? 'YES ✅' : `NO ❌ (charged $${totalCharges})`);
    
    console.log('\n✅ Stripe shows Pro:', results.stripeShowsPro ? 'YES ✅' : 'NO ❌');
    console.log('   Expected: "ChatterForms Pro (HIPAA-Compliant)"');
    console.log('   Actual:', updatedProduct.name);
    
    console.log('\n✅ Invoice preview correct:', results.invoicePreviewCorrect ? 'YES ✅' : 'NO ❌');
    console.log('   Expected: $39.99');
    console.log('   Actual:', `$${upcomingAmount.toFixed(2)}`);
    
    console.log('\n⚠️  $0 invoices created:', newInvoices);
    console.log('   (This is expected - Stripe creates $0 invoice with proration_behavior: none)');
    
    // ===================================================================
    // Final Verdict
    // ===================================================================
    console.log('\n═══════════════════════════════════════════════════════════');
    const allPassed = results.trialPreserved && 
                     results.zeroCharges && 
                     results.stripeShowsPro && 
                     results.invoicePreviewCorrect;
    
    if (allPassed) {
      console.log('🎉 VERIFICATION PASSED ✅');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('\nConclusion:');
      console.log('✅ Direct item updates with proration_behavior: "none" WORK!');
      console.log('✅ No charges during trial');
      console.log('✅ Stripe shows correct plan');
      console.log('✅ Invoice preview correct');
      console.log('✅ Trial period preserved');
      console.log('\nSide effect:');
      console.log(`⚠️  Creates ${newInvoices} $0.00 invoice(s) per change`);
      console.log('   (Standard Stripe behavior - acceptable tradeoff)');
      console.log('\nRecommendation:');
      console.log('✅ SAFE TO IMPLEMENT direct updates for trial changes');
    } else {
      console.log('❌ VERIFICATION FAILED ❌');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('\nFailed checks:');
      if (!results.trialPreserved) console.log('❌ Trial was not preserved');
      if (!results.zeroCharges) console.log('❌ Charges occurred:', `$${totalCharges}`);
      if (!results.stripeShowsPro) console.log('❌ Stripe shows wrong plan');
      if (!results.invoicePreviewCorrect) console.log('❌ Invoice preview wrong');
      console.log('\nRecommendation:');
      console.log('❌ DO NOT implement - needs different approach');
    }
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await stripe.subscriptions.cancel(subscription.id);
    await stripe.customers.del(customer.id);
    console.log('✅ Cleanup complete\n');
    
    return {
      success: allPassed,
      results: results
    };
    
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    console.error('\nStack:', error.stack);
    
    // Cleanup on error
    if (subscription) {
      try {
        await stripe.subscriptions.cancel(subscription.id);
      } catch (e) {
        console.error('Cleanup error (subscription):', e.message);
      }
    }
    if (customer) {
      try {
        await stripe.customers.del(customer.id);
      } catch (e) {
        console.error('Cleanup error (customer):', e.message);
      }
    }
    
    throw error;
  }
}

// Run verification
if (require.main === module) {
  verifyProrationNone()
    .then(({ success, results }) => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyProrationNone };

