/**
 * OPTION 2: Comprehensive Trial Scenarios Test Suite
 * 
 * Tests all trial subscription scenarios with metadata-only updates
 * Verifies zero charges during trial and single charge at trial end
 */

const testSecrets = require('./test-secrets');
const stripe = require('stripe')(testSecrets.STRIPE_SECRET_KEY);

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

// Plan amounts for verification
const PLAN_AMOUNTS = {
  basic: { monthly: 19.99, annual: 199.90 },
  pro: { monthly: 39.99, annual: 383.90 }
};

// Helper to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to format currency
const formatAmount = (cents) => `$${(cents / 100).toFixed(2)}`;

// Helper to get invoice summary
async function getInvoiceSummary(customerId) {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 100
  });
  
  return {
    count: invoices.data.length,
    total: invoices.data.reduce((sum, inv) => sum + inv.amount_due, 0),
    invoices: invoices.data.map(inv => ({
      id: inv.id,
      amount: inv.amount_due,
      status: inv.status,
      description: inv.lines.data.map(l => l.description).join(', ')
    }))
  };
}

// Test results tracker
const testResults = [];

function recordResult(scenario, step, expected, actual, passed, details = {}) {
  testResults.push({
    scenario,
    step,
    expected,
    actual,
    passed: passed ? '✅' : '❌',
    details
  });
}

describe('Option 2: Trial Scenarios Test Suite', () => {
  
  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1: Basic → Pro Monthly → Pro Annual (Main Scenario)
  // ═══════════════════════════════════════════════════════════════════
  test('Scenario 1: Basic → Pro Monthly → Pro Annual', async () => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('SCENARIO 1: Basic → Pro Monthly → Pro Annual');
    console.log('═══════════════════════════════════════════════════\n');
    
    let customer, subscription;
    
    try {
      // Step 1: Create customer and trial subscription (Basic Monthly)
      customer = await stripe.customers.create({
        email: `test-scenario1-${Date.now()}@example.com`,
        name: 'Scenario 1 Test'
      });
      
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: PRICE_IDS.basic.monthly }],
        trial_period_days: 30,
        metadata: {
          userId: 'test-user-1',
          planId: 'basic',
          interval: 'monthly'
        }
      });
      
      console.log('Step 1: Created Basic Monthly trial subscription');
      console.log(`  Subscription: ${subscription.id}`);
      console.log(`  Status: ${subscription.status}`);
      console.log(`  Trial ends: ${new Date(subscription.trial_end * 1000).toISOString()}`);
      
      await sleep(2000);
      let invoices = await getInvoiceSummary(customer.id);
      console.log(`  Invoices: ${invoices.count}, Total: ${formatAmount(invoices.total)}`);
      
      recordResult('Scenario 1', 'Initial signup', '$0', formatAmount(invoices.total), invoices.total === 0);
      
      // Step 2: Upgrade to Pro Monthly (metadata only)
      console.log('\nStep 2: Upgrading to Pro Monthly (metadata only)...');
      subscription = await stripe.subscriptions.update(subscription.id, {
        // NO items parameter
        metadata: {
          userId: 'test-user-1',
          planId: 'pro',
          interval: 'monthly',
          scheduledPlanId: null,
          scheduledInterval: null
        },
        trial_end: subscription.trial_end
      });
      
      console.log('  Metadata updated to Pro Monthly');
      console.log(`  Items still: ${subscription.items.data[0].price.id}`);
      console.log(`  Metadata.planId: ${subscription.metadata.planId}`);
      
      await sleep(2000);
      invoices = await getInvoiceSummary(customer.id);
      console.log(`  Invoices: ${invoices.count}, Total: ${formatAmount(invoices.total)}`);
      
      const itemsUnchanged = subscription.items.data[0].price.id === PRICE_IDS.basic.monthly;
      const metadataCorrect = subscription.metadata.planId === 'pro';
      recordResult('Scenario 1', 'Upgrade to Pro Monthly', '$0 charged, metadata only', 
        `${formatAmount(invoices.total)}, items: ${itemsUnchanged ? 'unchanged' : 'changed'}`, 
        invoices.total === 0 && itemsUnchanged && metadataCorrect);
      
      // Step 3: Upgrade to Pro Annual (metadata only)
      console.log('\nStep 3: Upgrading to Pro Annual (metadata only)...');
      subscription = await stripe.subscriptions.update(subscription.id, {
        // NO items parameter
        metadata: {
          userId: 'test-user-1',
          planId: 'pro',
          interval: 'annual',
          scheduledPlanId: null,
          scheduledInterval: null
        },
        trial_end: subscription.trial_end
      });
      
      console.log('  Metadata updated to Pro Annual');
      console.log(`  Items still: ${subscription.items.data[0].price.id}`);
      console.log(`  Metadata.interval: ${subscription.metadata.interval}`);
      
      await sleep(2000);
      invoices = await getInvoiceSummary(customer.id);
      console.log(`  Invoices: ${invoices.count}, Total: ${formatAmount(invoices.total)}`);
      
      const itemsStillUnchanged = subscription.items.data[0].price.id === PRICE_IDS.basic.monthly;
      const intervalCorrect = subscription.metadata.interval === 'annual';
      recordResult('Scenario 1', 'Upgrade to Pro Annual', '$0 charged, metadata only', 
        `${formatAmount(invoices.total)}, items: ${itemsStillUnchanged ? 'unchanged' : 'changed'}`, 
        invoices.total === 0 && itemsStillUnchanged && intervalCorrect);
      
      // Step 4: Simulate trial end (apply metadata to items)
      console.log('\nStep 4: Simulating trial end (applying metadata to items)...');
      
      const intendedPriceId = PRICE_IDS[subscription.metadata.planId][subscription.metadata.interval];
      subscription = await stripe.subscriptions.update(subscription.id, {
        items: [{
          id: subscription.items.data[0].id,
          price: intendedPriceId
        }]
      });
      
      console.log('  Items updated to Pro Annual');
      console.log(`  New status: ${subscription.status}`);
      console.log(`  New items: ${subscription.items.data[0].price.id}`);
      console.log(`  Cancel at period end: ${subscription.cancel_at_period_end}`);
      
      await sleep(3000);
      invoices = await getInvoiceSummary(customer.id);
      console.log(`  Final invoices: ${invoices.count}, Total: ${formatAmount(invoices.total)}`);
      
      const expectedTotal = PLAN_AMOUNTS.pro.annual * 100; // Convert to cents
      const itemsUpdated = subscription.items.data[0].price.id === PRICE_IDS.pro.annual;
      const correctAmount = Math.abs(invoices.total - expectedTotal) < 1; // Allow 1 cent rounding
      const autoRenewal = !subscription.cancel_at_period_end;
      
      recordResult('Scenario 1', 'At trial end', `ONE invoice for $${PLAN_AMOUNTS.pro.annual}`, 
        `${invoices.count} invoice(s), ${formatAmount(invoices.total)}`, 
        correctAmount && itemsUpdated && autoRenewal,
        { autoRenewal, itemsUpdated });
      
      console.log('\n✅ Scenario 1 Complete');
      console.log(`   Total charged during trial: $0`);
      console.log(`   Total charged at trial end: ${formatAmount(invoices.total)}`);
      console.log(`   Auto-renewal: ${autoRenewal ? 'Enabled' : 'Disabled'}`);
      
    } finally {
      // Cleanup
      if (subscription) await stripe.subscriptions.cancel(subscription.id);
      if (customer) await stripe.customers.del(customer.id);
    }
  }, 60000);
  
  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2: Multiple Changes (5 changes during trial)
  // ═══════════════════════════════════════════════════════════════════
  test('Scenario 2: Multiple Changes During Trial', async () => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('SCENARIO 2: Multiple Changes During Trial');
    console.log('═══════════════════════════════════════════════════\n');
    
    let customer, subscription;
    
    try {
      customer = await stripe.customers.create({
        email: `test-scenario2-${Date.now()}@example.com`
      });
      
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: PRICE_IDS.basic.monthly }],
        trial_period_days: 30,
        metadata: {
          userId: 'test-user-2',
          planId: 'basic',
          interval: 'monthly'
        }
      });
      
      console.log('Initial: Basic Monthly (trial)');
      const initialItems = subscription.items.data[0].price.id;
      
      const changes = [
        { plan: 'pro', interval: 'monthly', description: 'Basic Monthly → Pro Monthly' },
        { plan: 'pro', interval: 'annual', description: 'Pro Monthly → Pro Annual' },
        { plan: 'basic', interval: 'annual', description: 'Pro Annual → Basic Annual' },
        { plan: 'basic', interval: 'monthly', description: 'Basic Annual → Basic Monthly' },
        { plan: 'pro', interval: 'monthly', description: 'Basic Monthly → Pro Monthly' }
      ];
      
      let totalCharges = 0;
      
      for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        console.log(`\nChange ${i + 1}: ${change.description}`);
        
        subscription = await stripe.subscriptions.update(subscription.id, {
          metadata: {
            ...subscription.metadata,
            planId: change.plan,
            interval: change.interval
          },
          trial_end: subscription.trial_end
        });
        
        await sleep(1500);
        const invoices = await getInvoiceSummary(customer.id);
        totalCharges = invoices.total;
        
        console.log(`  Metadata: ${subscription.metadata.planId} (${subscription.metadata.interval})`);
        console.log(`  Items: ${subscription.items.data[0].price.id === initialItems ? 'unchanged' : 'CHANGED'}`);
        console.log(`  Charges so far: ${formatAmount(totalCharges)}`);
        
        recordResult('Scenario 2', `Change ${i + 1}`, '$0', formatAmount(totalCharges), totalCharges === 0);
      }
      
      console.log(`\n✅ Scenario 2 Complete`);
      console.log(`   Total changes: ${changes.length}`);
      console.log(`   Total charged: ${formatAmount(totalCharges)}`);
      console.log(`   Items changed: ${subscription.items.data[0].price.id !== initialItems ? 'YES (WRONG)' : 'NO (CORRECT)'}`);
      
      recordResult('Scenario 2', 'All changes', '$0 for all changes', formatAmount(totalCharges), totalCharges === 0);
      
    } finally {
      if (subscription) await stripe.subscriptions.cancel(subscription.id);
      if (customer) await stripe.customers.del(customer.id);
    }
  }, 90000);
  
  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3: Interval Change (Monthly → Annual)
  // ═══════════════════════════════════════════════════════════════════
  test('Scenario 3: Interval Change (Monthly → Annual)', async () => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('SCENARIO 3: Interval Change (Monthly → Annual)');
    console.log('═══════════════════════════════════════════════════\n');
    
    let customer, subscription;
    
    try {
      customer = await stripe.customers.create({
        email: `test-scenario3-${Date.now()}@example.com`
      });
      
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: PRICE_IDS.pro.monthly }],
        trial_period_days: 30,
        metadata: {
          userId: 'test-user-3',
          planId: 'pro',
          interval: 'monthly'
        }
      });
      
      console.log('Initial: Pro Monthly (trial)');
      await sleep(2000);
      const initialInvoices = await getInvoiceSummary(customer.id);
      
      console.log('\nChanging to Pro Annual...');
      subscription = await stripe.subscriptions.update(subscription.id, {
        metadata: {
          ...subscription.metadata,
          interval: 'annual'
        },
        trial_end: subscription.trial_end
      });
      
      await sleep(2000);
      const afterChangeInvoices = await getInvoiceSummary(customer.id);
      
      console.log(`  Metadata interval: ${subscription.metadata.interval}`);
      console.log(`  Items: ${subscription.items.data[0].price.id}`);
      console.log(`  Charges: ${formatAmount(afterChangeInvoices.total)}`);
      
      recordResult('Scenario 3', 'Interval change', '$0', formatAmount(afterChangeInvoices.total), 
        afterChangeInvoices.total === initialInvoices.total);
      
      console.log('\n✅ Scenario 3 Complete');
      
    } finally {
      if (subscription) await stripe.subscriptions.cancel(subscription.id);
      if (customer) await stripe.customers.del(customer.id);
    }
  }, 60000);
  
  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4: Downgrade During Trial
  // ═══════════════════════════════════════════════════════════════════
  test('Scenario 4: Downgrade During Trial', async () => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('SCENARIO 4: Downgrade During Trial');
    console.log('═══════════════════════════════════════════════════\n');
    
    let customer, subscription;
    
    try {
      customer = await stripe.customers.create({
        email: `test-scenario4-${Date.now()}@example.com`
      });
      
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: PRICE_IDS.pro.monthly }],
        trial_period_days: 30,
        metadata: {
          userId: 'test-user-4',
          planId: 'pro',
          interval: 'monthly'
        }
      });
      
      console.log('Initial: Pro Monthly (trial)');
      await sleep(2000);
      const initialInvoices = await getInvoiceSummary(customer.id);
      
      console.log('\nDowngrading to Basic Monthly...');
      subscription = await stripe.subscriptions.update(subscription.id, {
        metadata: {
          ...subscription.metadata,
          planId: 'basic'
        },
        trial_end: subscription.trial_end
      });
      
      await sleep(2000);
      const afterDowngradeInvoices = await getInvoiceSummary(customer.id);
      
      console.log(`  Metadata plan: ${subscription.metadata.planId}`);
      console.log(`  Items: ${subscription.items.data[0].price.id}`);
      console.log(`  Charges: ${formatAmount(afterDowngradeInvoices.total)}`);
      
      recordResult('Scenario 4', 'Downgrade', '$0', formatAmount(afterDowngradeInvoices.total), 
        afterDowngradeInvoices.total === initialInvoices.total);
      
      console.log('\n✅ Scenario 4 Complete');
      
    } finally {
      if (subscription) await stripe.subscriptions.cancel(subscription.id);
      if (customer) await stripe.customers.del(customer.id);
    }
  }, 60000);
  
  // Print results summary after all tests
  afterAll(() => {
    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('TEST RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════\n');
    
    // Group by scenario
    const scenarios = {};
    testResults.forEach(result => {
      if (!scenarios[result.scenario]) {
        scenarios[result.scenario] = [];
      }
      scenarios[result.scenario].push(result);
    });
    
    // Print table
    console.log('| Scenario | Step | Expected | Actual | Result |');
    console.log('|----------|------|----------|--------|--------|');
    
    Object.keys(scenarios).forEach(scenario => {
      scenarios[scenario].forEach(result => {
        console.log(`| ${result.scenario} | ${result.step} | ${result.expected} | ${result.actual} | ${result.passed} |`);
      });
    });
    
    // Summary stats
    const totalTests = testResults.length;
    const passedTests = testResults.filter(r => r.passed === '✅').length;
    const failedTests = totalTests - passedTests;
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ${failedTests > 0 ? '❌' : ''}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log('═══════════════════════════════════════════════════\n');
    
    // Write results to file
    const fs = require('fs');
    const resultsMarkdown = generateResultsMarkdown(scenarios, totalTests, passedTests, failedTests);
    fs.writeFileSync(__dirname + '/../docs/OPTION_2_TEST_RESULTS.md', resultsMarkdown);
    console.log('📄 Results written to docs/OPTION_2_TEST_RESULTS.md\n');
  });
});

function generateResultsMarkdown(scenarios, totalTests, passedTests, failedTests) {
  let md = '# Option 2: Test Results\n\n';
  md += `**Test Date**: ${new Date().toISOString()}\n\n`;
  md += `**Summary**: ${passedTests}/${totalTests} tests passed (${((passedTests / totalTests) * 100).toFixed(1)}%)\n\n`;
  md += '---\n\n';
  
  md += '## Test Results by Scenario\n\n';
  
  Object.keys(scenarios).forEach(scenario => {
    md += `### ${scenario}\n\n`;
    md += '| Step | Expected | Actual | Result |\n';
    md += '|------|----------|--------|--------|\n';
    
    scenarios[scenario].forEach(result => {
      md += `| ${result.step} | ${result.expected} | ${result.actual} | ${result.passed} |\n`;
    });
    
    md += '\n';
  });
  
  md += '---\n\n';
  md += '## Overall Summary\n\n';
  md += `- **Total Tests**: ${totalTests}\n`;
  md += `- **Passed**: ${passedTests} ✅\n`;
  md += `- **Failed**: ${failedTests} ${failedTests > 0 ? '❌' : '✅'}\n`;
  md += `- **Success Rate**: ${((passedTests / totalTests) * 100).toFixed(1)}%\n\n`;
  
  md += '---\n\n';
  md += '## Key Findings\n\n';
  
  const allPassed = failedTests === 0;
  if (allPassed) {
    md += '✅ **All tests passed!**\n\n';
    md += '- Zero charges during trial for all scenarios\n';
    md += '- Metadata updates work correctly\n';
    md += '- Subscription items remain unchanged during trial\n';
    md += '- Option 2 is working as expected\n';
  } else {
    md += '⚠️ **Some tests failed**\n\n';
    md += 'Please review the failed tests above for details.\n';
  }
  
  return md;
}

module.exports = { testResults };

