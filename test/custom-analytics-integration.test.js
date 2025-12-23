/**
 * Custom Analytics Integration Tests
 * Tests for API endpoints with mocked dependencies
 * 
 * To run: npm test test/custom-analytics-integration.test.js
 * 
 * Note: These tests mock GCP client and JWT verification
 */

// Mock dependencies before requiring server
jest.mock('../gcp-client');
jest.mock('jsonwebtoken');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock GCP Client
const mockGcpClient = {
  getFormStructure: jest.fn(),
  getFormSubmissions: jest.fn(),
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn()
    })),
    where: jest.fn(() => ({
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn()
        }))
      })),
      limit: jest.fn(() => ({
        get: jest.fn()
      }))
    }))
  }))
};

// Mock getUserIdFromRequest
const mockGetUserIdFromRequest = jest.fn();

// Create minimal Express app for testing
const app = express();
app.use(express.json());

// Mock server endpoints (simplified version)
app.post('/api/analytics/forms/:formId/custom/analyze', async (req, res) => {
  try {
    const { formId } = req.params;
    const userId = mockGetUserIdFromRequest(req);
    
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const template_type = req.body.template_type || req.body.templateType;
    const primary_field_id = req.body.primary_field_id || req.body.primaryFieldId;
    const secondary_field_id = req.body.secondary_field_id || req.body.secondaryFieldId;
    const filters = req.body.filters || [];
    const aggregation = req.body.aggregation || 'mean';
    const time_granularity = req.body.time_granularity || req.body.timeGranularity || null;
    const date_range = req.body.date_range || req.body.dateRange;
    
    if (!template_type || !primary_field_id || !secondary_field_id) {
      return res.status(400).json({
        success: false,
        error: 'template_type, primary_field_id, and secondary_field_id are required'
      });
    }
    
    const validAggregations = ['mean', 'median', 'p90'];
    if (aggregation && !validAggregations.includes(aggregation)) {
      return res.status(400).json({
        success: false,
        error: `Invalid aggregation. Must be one of: ${validAggregations.join(', ')}`
      });
    }
    
    const formDoc = await mockGcpClient.getFormStructure(formId, true);
    if (!formDoc) {
      return res.status(404).json({ success: false, error: 'Form not found' });
    }
    
    const fields = formDoc.structure?.fields || formDoc.fields || [];
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
    
    const { validateFieldCompatibility, computeCustomAnalysis } = require('../utils/custom-analytics');
    const compatible = validateFieldCompatibility(template_type, primaryField, secondaryField);
    
    if (!compatible) {
      return res.status(400).json({
        success: false,
        error: 'Field types not compatible with selected template'
      });
    }
    
    let startDate, endDate;
    if (date_range && date_range.start && date_range.end) {
      startDate = new Date(date_range.start);
      endDate = new Date(date_range.end);
    } else {
      endDate = new Date();
      startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - 30);
    }
    
    const submissions = await mockGcpClient.getFormSubmissions(formId, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
    
    if (submissions.length > 10000) {
      return res.status(400).json({
        success: false,
        error: `Too many submissions (${submissions.length}). Reduce date range to analyze.`
      });
    }
    
    const result = computeCustomAnalysis(
      submissions,
      template_type,
      primaryField,
      secondaryField,
      { filters, aggregation, time_granularity }
    );
    
    if (result.error) {
      return res.status(400).json({
        success: false,
        error: result.error,
        sampleSize: result.sampleSize
      });
    }
    
    res.json({
      success: true,
      analysis: {
        template_type,
        selected_fields: {
          primary: { id: primaryField.id, label: primaryField.label, type: primaryField.type },
          secondary: { id: secondaryField.id, label: secondaryField.label, type: secondaryField.type }
        },
        bigNumber: result.bigNumber,
        chartType: result.chartType,
        chartData: result.chartData,
        sampleSize: result.sampleSize,
        strength: result.strength
      },
      submission_count: submissions.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

describe('Custom Analytics API - POST /api/analytics/forms/:formId/custom/analyze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserIdFromRequest.mockReturnValue('user123');
  });

  const formId = 'form123';
  const mockForm = {
    structure: {
      fields: [
        { id: 'rating', label: 'Rating', type: 'number' },
        { id: 'category', label: 'Category', type: 'select', options: ['A', 'B'] },
        { id: 'date', label: 'Date', type: 'date' }
      ]
    }
  };

  const mockSubmissions = [
    { submission_data: { rating: 5, category: 'A' } },
    { submission_data: { rating: 4, category: 'A' } },
    { submission_data: { rating: 5, category: 'B' } }
  ];

  test('should return 401 when user not authenticated', async () => {
    mockGetUserIdFromRequest.mockReturnValue(null);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category'
      });
    
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Unauthorized');
  });

  test('should return 400 when required fields missing', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown'
        // Missing primary_field_id and secondary_field_id
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('required');
  });

  test('should return 404 when form not found', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(null);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category'
      });
    
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Form not found');
  });

  test('should return 400 when field not found', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'nonexistent',
        secondary_field_id: 'category'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.missing_primary).toBe(true);
  });

  test('should return 400 when field types incompatible', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'category', // Wrong: should be number
        secondary_field_id: 'rating'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('not compatible');
  });

  test('should return 400 for invalid aggregation', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category',
        aggregation: 'invalid-aggregation'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Invalid aggregation');
  });

  test('should successfully analyze Breakdown template', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    mockGcpClient.getFormSubmissions.mockResolvedValue(mockSubmissions);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category',
        aggregation: 'mean'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.analysis).toBeDefined();
    expect(response.body.analysis.template_type).toBe('breakdown');
    expect(response.body.analysis.bigNumber).toBeDefined();
    expect(response.body.analysis.chartType).toBe('bars');
    expect(response.body.analysis.chartData).toBeDefined();
    expect(response.body.analysis.sampleSize).toBe(3);
  });

  test('should handle camelCase request body fields', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    mockGcpClient.getFormSubmissions.mockResolvedValue(mockSubmissions);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        templateType: 'breakdown', // camelCase
        primaryFieldId: 'rating', // camelCase
        secondaryFieldId: 'category', // camelCase
        aggregation: 'mean'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('should apply filters correctly', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    mockGcpClient.getFormSubmissions.mockResolvedValue(mockSubmissions);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category',
        filters: [
          { field_id: 'category', operator: 'equals', value: 'A' }
        ],
        aggregation: 'mean'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // Should only analyze filtered submissions (category A)
    expect(response.body.analysis.sampleSize).toBe(2);
  });

  test('should return 400 when too many submissions', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    const largeSubmissions = Array.from({ length: 10001 }, (_, i) => ({
      submission_data: { rating: 5, category: 'A' }
    }));
    mockGcpClient.getFormSubmissions.mockResolvedValue(largeSubmissions);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Too many submissions');
  });

  test('should handle Over Time template', async () => {
    const dateSubmissions = [
      { submission_data: { date: '2024-01-15T00:00:00Z', rating: 5 } },
      { submission_data: { date: '2024-01-16T00:00:00Z', rating: 4 } }
    ];
    
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    mockGcpClient.getFormSubmissions.mockResolvedValue(dateSubmissions);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'over-time',
        primary_field_id: 'date',
        secondary_field_id: 'rating',
        time_granularity: 'day',
        aggregation: 'mean'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.analysis.template_type).toBe('over-time');
    expect(response.body.analysis.chartType).toBe('line');
  });

  test('should handle insufficient data error', async () => {
    mockGcpClient.getFormStructure.mockResolvedValue(mockForm);
    mockGcpClient.getFormSubmissions.mockResolvedValue([
      { submission_data: { rating: 5, category: 'A' } } // Only 1 submission
    ]);
    
    const response = await request(app)
      .post(`/api/analytics/forms/${formId}/custom/analyze`)
      .send({
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBeDefined();
    expect(response.body.sampleSize).toBe(1);
  });
});

