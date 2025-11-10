/**
 * Manual Trial API Endpoint Tests
 * 
 * Tests trial subscription endpoints with real credentials
 * Run with: JWT_TOKEN=... npm test -- trial-api-manual
 */

const request = require('supertest');
const axios = require('axios');

// Test credentials
const JWT_TOKEN = process.env.JWT_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ6aVFGQVhFWHd0WThUb3ppUFBIYSIsImVtYWlsIjoiYWtqX3dvcmsrNTRAeWFob28uY29tIiwiaWF0IjoxNzYyMjk0NDQ1LCJleHAiOjE3NjI4OTkyNDV9.mpKEjW1-eqy0Rw8O6gNpToA-dj0QB8Jo9cXZdAYB8X4';
const API_URL = process.env.API_URL || 'https://my-poppler-api-dev.up.railway.app';
// Note: The billing routes are mounted at /api/billing, so full URL should be API_URL + /api/billing
const USER_ID = 'ziQFAXEXwtY8ToziPPHa';

describe('Trial API Endpoints - Manual Tests', () => {
  test('GET /api/billing/subscription - Should return subscription status', async () => {
    const response = await axios.get(`${API_URL}/api/billing/subscription`, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`
      }
    });

    console.log('📊 Subscription Status:', JSON.stringify(response.data, null, 2));
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('plan');
    expect(response.data).toHaveProperty('status');
    
    // Check if trial fields are present
    if (response.data.status === 'trialing') {
      expect(response.data).toHaveProperty('isTrial', true);
      expect(response.data).toHaveProperty('trialEnd');
      expect(response.data).toHaveProperty('trialEndingSoon');
    }
  });

  test('POST /api/billing/create-trial-checkout-session - Trial eligibility check', async () => {
    try {
      const response = await axios.post(
        `${API_URL}/api/billing/create-trial-checkout-session`,
        {
          planId: 'pro',
          interval: 'monthly'
        },
        {
          headers: {
            'Authorization': `Bearer ${JWT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ Trial checkout created:', response.data.sessionUrl);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('sessionUrl');
    } catch (error) {
      if (error.response) {
        console.log('❌ Trial eligibility check:', error.response.data.error);
        // Expected if user already has trial or paid subscription
        expect([400, 401]).toContain(error.response.status);
      } else {
        throw error;
      }
    }
  });

  test('POST /api/billing/change-plan - Plan change during trial', async () => {
    // First get current subscription
    const statusResponse = await axios.get(`${API_URL}/api/billing/subscription`, {
      headers: { 'Authorization': `Bearer ${JWT_TOKEN}` }
    });

    if (statusResponse.data.status === 'trialing') {
      console.log('✅ User has trialing subscription, testing plan change...');
      
      try {
        const response = await axios.post(
          `${API_URL}/api/billing/change-plan`,
          {
            newPlanId: 'basic',
            interval: 'monthly'
          },
          {
            headers: {
              'Authorization': `Bearer ${JWT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('✅ Plan change scheduled:', response.data);
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('success', true);
        expect(response.data.message).toContain('trial period');
      } catch (error) {
        console.log('❌ Plan change error:', error.response?.data || error.message);
        throw error;
      }
    } else {
      console.log('ℹ️  User does not have trialing subscription, skipping plan change test');
    }
  });

  test('POST /api/billing/change-interval - Interval change allowed during trial', async () => {
    const statusResponse = await axios.get(`${API_URL}/api/billing/subscription`, {
      headers: { 'Authorization': `Bearer ${JWT_TOKEN}` }
    });

    if (statusResponse.data.status === 'trialing' || statusResponse.data.isTrial) {
      try {
        const response = await axios.post(
          `${API_URL}/api/billing/change-interval`,
          {
            newInterval: 'annual'
          },
          {
            headers: {
              'Authorization': `Bearer ${JWT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        // Should succeed - interval changes are now allowed during trial
        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log('✅ Interval change during trial succeeded:', response.data.message);
      } catch (error) {
        // Should not fail - interval changes are allowed
        console.log('❌ Interval change error (unexpected):', error.response?.data || error.message);
        throw error;
      }
    } else {
      console.log('ℹ️  User does not have trialing subscription, skipping interval change test');
    }
  });
});

