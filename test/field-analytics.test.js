/**
 * Field Analytics Tests
 * Tests for field-level analytics computation and semantic type detection
 * 
 * To run: npm test test/field-analytics.test.js
 */

const {
  detectSemanticType,
  shouldSkipField
} = require('../utils/field-semantics');

const {
  computeFieldAnalytics,
  analyzeCategoricalField,
  analyzeRatingField,
  analyzeCheckboxField,
  analyzeMultiSelectField,
  analyzeBooleanField,
  analyzeTextField,
  analyzeNumericField,
  analyzeDateField,
  normalizeRatingValue
} = require('../utils/field-analytics');

describe('Field Semantics', () => {
  describe('detectSemanticType', () => {
    test('should return null for skip fields', () => {
      expect(detectSemanticType({ type: 'payment' })).toBeNull();
      expect(detectSemanticType({ type: 'calendly' })).toBeNull();
      expect(detectSemanticType({ type: 'image' })).toBeNull();
      expect(detectSemanticType({ type: 'signature' })).toBeNull();
      expect(detectSemanticType({ type: 'file' })).toBeNull();
      expect(detectSemanticType({ type: 'richtext' })).toBeNull();
    });

    test('should return opinion_score for rating fields', () => {
      expect(detectSemanticType({ type: 'rating' })).toBe('opinion_score');
    });

    test('should detect demographic fields by keywords', () => {
      expect(detectSemanticType({ type: 'select', label: 'Gender' })).toBe('demographic');
      expect(detectSemanticType({ type: 'radio', label: 'Age Group' })).toBe('demographic');
      expect(detectSemanticType({ type: 'select', label: 'Country' })).toBe('demographic');
      expect(detectSemanticType({ type: 'select', label: 'Education Level' })).toBe('demographic');
    });

    test('should return preference for non-demographic select/radio', () => {
      expect(detectSemanticType({ type: 'select', label: 'Favorite Color' })).toBe('preference');
      expect(detectSemanticType({ type: 'radio', label: 'Preferred Option' })).toBe('preference');
    });

    test('should detect consent fields by keywords', () => {
      expect(detectSemanticType({ type: 'checkbox', label: 'I agree to the terms' })).toBe('consent');
      expect(detectSemanticType({ type: 'checkbox', label: 'I consent to data processing' })).toBe('consent');
      expect(detectSemanticType({ type: 'checkbox', label: 'Accept policy' })).toBe('consent');
    });

    test('should return preference for non-consent checkboxes', () => {
      expect(detectSemanticType({ type: 'checkbox', label: 'Select features' })).toBe('preference');
    });

    test('should detect free_feedback text fields', () => {
      expect(detectSemanticType({ type: 'text', label: 'Additional feedback' })).toBe('free_feedback');
      expect(detectSemanticType({ type: 'textarea', label: 'Comments' })).toBe('free_feedback');
      expect(detectSemanticType({ type: 'text', label: 'Any other suggestions?' })).toBe('free_feedback');
    });

    test('should return identity for non-feedback text fields', () => {
      expect(detectSemanticType({ type: 'text', label: 'Name' })).toBe('identity');
      expect(detectSemanticType({ type: 'email', label: 'Email' })).toBe('identity');
    });

    test('should detect demographic number fields', () => {
      expect(detectSemanticType({ type: 'number', label: 'Age' })).toBe('demographic');
      expect(detectSemanticType({ type: 'number', label: 'Annual Income' })).toBe('demographic');
    });

    test('should return behavior for non-demographic number fields', () => {
      expect(detectSemanticType({ type: 'number', label: 'Quantity' })).toBe('behavior');
    });

    test('should detect demographic date fields', () => {
      expect(detectSemanticType({ type: 'date', label: 'Date of Birth' })).toBe('demographic');
      expect(detectSemanticType({ type: 'date', label: 'DOB' })).toBe('demographic');
    });

    test('should return behavior for non-demographic date fields', () => {
      expect(detectSemanticType({ type: 'date', label: 'Appointment Date' })).toBe('behavior');
    });

    test('should handle radio-with-other type', () => {
      expect(detectSemanticType({ type: 'radio-with-other', label: 'Gender' })).toBe('demographic');
      expect(detectSemanticType({ type: 'radio-with-other', label: 'Option' })).toBe('preference');
    });
  });

  describe('shouldSkipField', () => {
    test('should return true for skip field types', () => {
      expect(shouldSkipField({ type: 'payment' })).toBe(true);
      expect(shouldSkipField({ type: 'calendly' })).toBe(true);
      expect(shouldSkipField({ type: 'image' })).toBe(true);
      expect(shouldSkipField({ type: 'signature' })).toBe(true);
      expect(shouldSkipField({ type: 'file' })).toBe(true);
      expect(shouldSkipField({ type: 'richtext' })).toBe(true);
    });

    test('should return false for analyzable fields', () => {
      expect(shouldSkipField({ type: 'text' })).toBe(false);
      expect(shouldSkipField({ type: 'select' })).toBe(false);
      expect(shouldSkipField({ type: 'rating' })).toBe(false);
    });
  });
});

describe('Field Analytics', () => {
  // Helper function to create mock submissions
  function createSubmissions(fieldId, values) {
    return values.map(value => ({
      submission_id: `sub-${Math.random()}`,
      form_id: 'test-form',
      submission_data: {
        [fieldId]: value
      },
      timestamp: new Date()
    }));
  }

  describe('analyzeCategoricalField', () => {
    test('should calculate option counts and percentages', () => {
      const field = { id: 'gender', label: 'Gender', type: 'select' };
      const submissions = createSubmissions('gender', ['Male', 'Female', 'Male', 'Other', 'Female']);
      const totalSubmissions = 5;

      const result = analyzeCategoricalField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(5);
      expect(result.optionCounts.Male).toBe(2);
      expect(result.optionCounts.Female).toBe(2);
      expect(result.optionCounts.Other).toBe(1);
      expect(result.percentages.Male).toBe(40);
      expect(result.percentages.Female).toBe(40);
      expect(result.percentages.Other).toBe(20);
      expect(result.completionRate).toBe(100);
    });

    test('should handle empty submissions', () => {
      const field = { id: 'gender', label: 'Gender', type: 'select' };
      const submissions = [];
      const totalSubmissions = 10;

      const result = analyzeCategoricalField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(0);
      expect(Object.keys(result.optionCounts).length).toBe(0);
      expect(result.completionRate).toBe(0);
    });

    test('should calculate completion rate correctly', () => {
      const field = { id: 'gender', label: 'Gender', type: 'select' };
      const submissions = createSubmissions('gender', ['Male', 'Female']);
      const totalSubmissions = 10; // 10 total, 2 responded

      const result = analyzeCategoricalField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(2);
      expect(result.completionRate).toBe(20); // 2/10 * 100
    });

    test('should handle null and empty string values', () => {
      const field = { id: 'gender', label: 'Gender', type: 'select' };
      const submissions = createSubmissions('gender', ['Male', null, '', 'Female']);
      const totalSubmissions = 4;

      const result = analyzeCategoricalField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(2); // Only 'Male' and 'Female' counted
    });
  });

  describe('analyzeRatingField', () => {
    test('should calculate mean, median, and mode', () => {
      const field = { id: 'satisfaction', label: 'Satisfaction', type: 'rating', ratingMax: 5 };
      const submissions = createSubmissions('satisfaction', [5, 4, 5, 3, 5, 4, 2]);
      const totalSubmissions = 7;

      const result = analyzeRatingField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(7);
      expect(result.mean).toBeCloseTo(4.0, 1); // (5+4+5+3+5+4+2)/7 ≈ 4.0
      expect(result.median).toBe(4);
      expect(result.mode).toBe(5); // Most frequent
      expect(result.completionRate).toBe(100);
    });

    test('should handle emoji ratings and normalize correctly', () => {
      const field = { 
        id: 'satisfaction', 
        label: 'Satisfaction', 
        type: 'rating', 
        ratingType: 'emojis' 
      };
      const submissions = createSubmissions('satisfaction', ['😀', '😐', '😀', '😞', '😀']);
      const totalSubmissions = 5;

      const result = analyzeRatingField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(5);
      // Verify normalization: 😀 = 5, 😐 = 3, 😞 = 1
      expect(result.mean).toBeCloseTo((5 + 3 + 5 + 1 + 5) / 5, 1); // Should be ~3.8
      expect(result.distribution[5]).toBe(3); // Three 😀 (5)
      expect(result.distribution[3]).toBe(1); // One 😐 (3)
      expect(result.distribution[1]).toBe(1); // One 😞 (1)
    });

    test('should handle half-ratings', () => {
      const field = { 
        id: 'satisfaction', 
        label: 'Satisfaction', 
        type: 'rating', 
        ratingAllowHalf: true 
      };
      const submissions = createSubmissions('satisfaction', [4.5, 4.0, 3.5, 5.0]);
      const totalSubmissions = 4;

      const result = analyzeRatingField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(4);
      expect(result.distribution).toBeDefined();
    });

    test('should calculate percentage above threshold', () => {
      const field = { id: 'satisfaction', label: 'Satisfaction', type: 'rating', ratingMax: 5 };
      const submissions = createSubmissions('satisfaction', [5, 4, 3, 2, 1]);
      const totalSubmissions = 5;

      const result = analyzeRatingField(field, submissions, totalSubmissions);

      // Threshold is 80% of max (5) = 4
      // 2 out of 5 are >= 4, so 40%
      expect(result.percentageAboveThreshold).toBe(40);
    });
  });

  describe('normalizeRatingValue', () => {
    test('should normalize emoji ratings', () => {
      const field = { ratingType: 'emojis' };
      expect(normalizeRatingValue('😀', field)).toBe(5);
      expect(normalizeRatingValue('😐', field)).toBe(3);
      expect(normalizeRatingValue('😞', field)).toBe(1);
    });

    test('should handle half-ratings when allowed', () => {
      const field = { ratingAllowHalf: true };
      expect(normalizeRatingValue(4.3, field)).toBe(4.5);
      expect(normalizeRatingValue(4.7, field)).toBe(4.5);
    });

    test('should round to integer when half-ratings not allowed', () => {
      const field = { ratingAllowHalf: false };
      expect(normalizeRatingValue(4.3, field)).toBe(4);
      expect(normalizeRatingValue(4.7, field)).toBe(5);
    });

    test('should return null for invalid values', () => {
      const field = {};
      expect(normalizeRatingValue('invalid', field)).toBeNull();
      expect(normalizeRatingValue(null, field)).toBeNull();
    });
  });

  describe('analyzeCheckboxField', () => {
    test('should detect multi-select checkbox', () => {
      const field = { id: 'features', label: 'Features', type: 'checkbox' };
      const submissions = createSubmissions('features', [
        ['Feature A', 'Feature B'],
        ['Feature A'],
        ['Feature C']
      ]);
      const totalSubmissions = 3;

      const result = analyzeCheckboxField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(3);
      expect(result.optionCounts).toBeDefined();
      expect(result.averageSelections).toBeDefined();
    });

    test('should detect single/boolean checkbox', () => {
      const field = { id: 'consent', label: 'I agree', type: 'checkbox' };
      const submissions = createSubmissions('consent', [true, false, true, true]);
      const totalSubmissions = 4;

      const result = analyzeCheckboxField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(4);
      expect(result.yesCount).toBe(3);
      expect(result.noCount).toBe(1);
      expect(result.yesPercentage).toBe(75);
    });

    test('should default to boolean when no data', () => {
      const field = { id: 'consent', label: 'I agree', type: 'checkbox' };
      const submissions = [];
      const totalSubmissions = 0;

      const result = analyzeCheckboxField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(0);
      expect(result.yesCount).toBe(0);
      expect(result.noCount).toBe(0);
    });
  });

  describe('analyzeMultiSelectField', () => {
    test('should calculate option counts and average selections', () => {
      const field = { id: 'features', label: 'Features', type: 'checkbox' };
      const submissions = createSubmissions('features', [
        ['A', 'B'],
        ['A'],
        ['B', 'C']
      ]);
      const totalSubmissions = 3;

      const result = analyzeMultiSelectField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(3);
      expect(result.optionCounts.A).toBe(2);
      expect(result.optionCounts.B).toBe(2);
      expect(result.optionCounts.C).toBe(1);
      expect(result.averageSelections).toBeCloseTo(1.67, 1); // 5 selections / 3 responses
      expect(result.completionRate).toBe(100);
    });

    test('should handle percentages that exceed 100%', () => {
      const field = { id: 'features', label: 'Features', type: 'checkbox' };
      const submissions = createSubmissions('features', [
        ['A', 'B', 'C'],
        ['A', 'B']
      ]);
      const totalSubmissions = 2;

      const result = analyzeMultiSelectField(field, submissions, totalSubmissions);

      // A appears in 2/2 = 100%, B appears in 2/2 = 100%, C appears in 1/2 = 50%
      expect(result.percentages.A).toBe(100);
      expect(result.percentages.B).toBe(100);
      expect(result.percentages.C).toBe(50);
    });
  });

  describe('analyzeBooleanField', () => {
    test('should handle boolean values', () => {
      const field = { id: 'consent', label: 'I agree', type: 'checkbox' };
      const submissions = createSubmissions('consent', [true, false, true, true]);
      const totalSubmissions = 4;

      const result = analyzeBooleanField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(4);
      expect(result.yesCount).toBe(3);
      expect(result.noCount).toBe(1);
      expect(result.yesPercentage).toBe(75);
      expect(result.noPercentage).toBe(25);
    });

    test('should handle string values', () => {
      const field = { id: 'consent', label: 'I agree', type: 'checkbox' };
      const submissions = createSubmissions('consent', ['true', 'false', 'yes', 'no']);
      const totalSubmissions = 4;

      const result = analyzeBooleanField(field, submissions, totalSubmissions);

      expect(result.yesCount).toBe(2); // 'true' and 'yes'
      expect(result.noCount).toBe(2); // 'false' and 'no'
    });

    test('should handle number values', () => {
      const field = { id: 'consent', label: 'I agree', type: 'checkbox' };
      const submissions = createSubmissions('consent', [1, 0, 1, 1]);
      const totalSubmissions = 4;

      const result = analyzeBooleanField(field, submissions, totalSubmissions);

      expect(result.yesCount).toBe(3);
      expect(result.noCount).toBe(1);
    });
  });

  describe('analyzeTextField', () => {
    test('should calculate word and character counts', () => {
      const field = { id: 'feedback', label: 'Feedback', type: 'textarea' };
      const submissions = createSubmissions('feedback', [
        'This is a test',
        'Another test with more words',
        'Short'
      ]);
      const totalSubmissions = 3;

      const result = analyzeTextField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(3);
      expect(result.averageWordCount).toBeGreaterThan(0);
      expect(result.averageCharacterCount).toBeGreaterThan(0);
      expect(result.completionRate).toBe(100);
    });

    test('should handle empty text fields', () => {
      const field = { id: 'feedback', label: 'Feedback', type: 'textarea' };
      const submissions = createSubmissions('feedback', ['', null]);
      const totalSubmissions = 10;

      const result = analyzeTextField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(0);
      expect(result.completionRate).toBe(0);
    });
  });

  describe('analyzeNumericField', () => {
    test('should calculate min, max, mean, median, and percentiles', () => {
      const field = { id: 'age', label: 'Age', type: 'number' };
      const submissions = createSubmissions('age', [18, 25, 30, 35, 40, 45, 50]);
      const totalSubmissions = 7;

      const result = analyzeNumericField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(7);
      expect(result.min).toBe(18);
      expect(result.max).toBe(50);
      expect(result.mean).toBeCloseTo(34.71, 1);
      expect(result.median).toBe(35);
      expect(result.percentiles.p25).toBe(25);
      expect(result.percentiles.p50).toBe(35);
      expect(result.percentiles.p75).toBe(45);
    });

    test('should handle invalid numeric values', () => {
      const field = { id: 'age', label: 'Age', type: 'number' };
      const submissions = createSubmissions('age', [25, 'invalid', 30, null, 35]);
      const totalSubmissions = 5;

      const result = analyzeNumericField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(3); // Only valid numbers counted
    });
  });

  describe('analyzeDateField', () => {
    test('should calculate distribution and day of week', () => {
      const field = { id: 'appointment', label: 'Appointment Date', type: 'date' };
      const date1 = new Date('2024-01-15'); // Monday
      const date2 = new Date('2024-01-16'); // Tuesday
      const date3 = new Date('2024-01-15'); // Monday again
      const submissions = createSubmissions('appointment', [
        date1.toISOString(),
        date2.toISOString(),
        date3.toISOString()
      ]);
      const totalSubmissions = 3;

      const result = analyzeDateField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(3);
      expect(result.distribution).toBeDefined();
      expect(result.dayOfWeek).toBeDefined();
      expect(result.dayOfWeek.Monday).toBe(2);
      expect(result.dayOfWeek.Tuesday).toBe(1);
    });

    test('should handle invalid dates', () => {
      const field = { id: 'appointment', label: 'Appointment Date', type: 'date' };
      const submissions = createSubmissions('appointment', ['invalid-date', null, '2024-01-15']);
      const totalSubmissions = 3;

      const result = analyzeDateField(field, submissions, totalSubmissions);

      expect(result.totalResponses).toBe(1); // Only valid date counted
    });
  });

  describe('computeFieldAnalytics', () => {
    test('should compute analytics for multiple fields', () => {
      const fields = [
        { id: 'gender', label: 'Gender', type: 'select' },
        { id: 'satisfaction', label: 'Satisfaction', type: 'rating', ratingMax: 5 },
        { id: 'feedback', label: 'Feedback', type: 'textarea' }
      ];
      const submissions = [
        {
          submission_id: 'sub1',
          form_id: 'test-form',
          submission_data: {
            gender: 'Male',
            satisfaction: 5,
            feedback: 'Great service'
          },
          timestamp: new Date()
        },
        {
          submission_id: 'sub2',
          form_id: 'test-form',
          submission_data: {
            gender: 'Female',
            satisfaction: 4,
            feedback: 'Good'
          },
          timestamp: new Date()
        }
      ];
      const totalSubmissions = 2;

      const result = computeFieldAnalytics(fields, submissions, totalSubmissions);

      expect(result.fields.length).toBe(3);
      expect(result.errors.length).toBe(0);
      
      const genderField = result.fields.find(f => f.fieldId === 'gender');
      expect(genderField).toBeDefined();
      expect(genderField.analytics.totalResponses).toBe(2);
      
      const ratingField = result.fields.find(f => f.fieldId === 'satisfaction');
      expect(ratingField).toBeDefined();
      expect(ratingField.analytics.totalResponses).toBe(2);
    });

    test('should skip non-analyzable fields', () => {
      const fields = [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'payment', label: 'Payment', type: 'payment' },
        { id: 'gender', label: 'Gender', type: 'select' }
      ];
      const submissions = [
        {
          submission_id: 'sub1',
          form_id: 'test-form',
          submission_data: { name: 'John', gender: 'Male' },
          timestamp: new Date()
        }
      ];
      const totalSubmissions = 1;

      const result = computeFieldAnalytics(fields, submissions, totalSubmissions);

      // Should only have 'name' and 'gender', not 'payment'
      expect(result.fields.length).toBe(2);
      expect(result.fields.find(f => f.fieldId === 'payment')).toBeUndefined();
    });

    test('should handle fields without IDs gracefully', () => {
      const fields = [
        { id: 'valid', label: 'Valid Field', type: 'text' },
        { label: 'No ID', type: 'text' } // Missing ID
      ];
      const submissions = [];
      const totalSubmissions = 0;

      const result = computeFieldAnalytics(fields, submissions, totalSubmissions);

      // Should only process field with ID
      expect(result.fields.length).toBe(1);
      expect(result.fields[0].fieldId).toBe('valid');
    });

    test('should handle empty fields array', () => {
      const result = computeFieldAnalytics([], [], 0);
      expect(result.fields.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    test('should skip unknown field types gracefully', () => {
      const fields = [
        { id: 'valid', label: 'Valid', type: 'text' },
        { id: 'invalid', label: 'Invalid', type: 'unknown-type' } // Unknown type
      ];
      const submissions = [];
      const totalSubmissions = 0;

      const result = computeFieldAnalytics(fields, submissions, totalSubmissions);

      // Should only have valid field, unknown type is skipped (not added to errors)
      expect(result.fields.length).toBe(1);
      expect(result.fields[0].fieldId).toBe('valid');
      expect(result.errors.length).toBe(0); // Unknown types don't generate errors, just skipped
    });

    test('should calculate completion rates correctly', () => {
      const fields = [
        { id: 'field1', label: 'Field 1', type: 'text' },
        { id: 'field2', label: 'Field 2', type: 'text' }
      ];
      const submissions = [
        {
          submission_id: 'sub1',
          form_id: 'test-form',
          submission_data: { field1: 'value1' }, // Only field1 has value
          timestamp: new Date()
        },
        {
          submission_id: 'sub2',
          form_id: 'test-form',
          submission_data: { field1: 'value2', field2: 'value3' }, // Both have values
          timestamp: new Date()
        }
      ];
      const totalSubmissions = 2;

      const result = computeFieldAnalytics(fields, submissions, totalSubmissions);

      const field1 = result.fields.find(f => f.fieldId === 'field1');
      const field2 = result.fields.find(f => f.fieldId === 'field2');

      expect(field1.analytics.completionRate).toBe(100); // 2/2 responded
      expect(field2.analytics.completionRate).toBe(50); // 1/2 responded
    });
  });

  describe('Edge Cases', () => {
    test('should handle null submission_data', () => {
      const field = { id: 'test', label: 'Test', type: 'text' };
      const submissions = [
        {
          submission_id: 'sub1',
          form_id: 'test-form',
          submission_data: null, // HIPAA case or missing data
          timestamp: new Date()
        }
      ];
      const totalSubmissions = 1;

      const result = analyzeTextField(field, submissions, totalSubmissions);
      expect(result.totalResponses).toBe(0);
      expect(result.completionRate).toBe(0);
    });

    test('should handle missing field in submission_data', () => {
      const field = { id: 'missing', label: 'Missing', type: 'text' };
      const submissions = [
        {
          submission_id: 'sub1',
          form_id: 'test-form',
          submission_data: { otherField: 'value' }, // Missing 'missing' field
          timestamp: new Date()
        }
      ];
      const totalSubmissions = 1;

      const result = analyzeTextField(field, submissions, totalSubmissions);
      expect(result.totalResponses).toBe(0);
      expect(result.completionRate).toBe(0);
    });

    test('should handle empty string vs null', () => {
      const field = { id: 'test', label: 'Test', type: 'text' };
      const submissions = createSubmissions('test', ['', null, 'value']);
      const totalSubmissions = 3;

      const result = analyzeTextField(field, submissions, totalSubmissions);
      // Empty string and null should both be ignored
      expect(result.totalResponses).toBe(1); // Only 'value' counted
    });

    test('should handle checkbox with empty arrays', () => {
      const field = { id: 'features', label: 'Features', type: 'checkbox' };
      const submissions = createSubmissions('features', [
        ['Feature A'],
        [], // Empty array
        ['Feature B']
      ]);
      const totalSubmissions = 3;

      const result = analyzeCheckboxField(field, submissions, totalSubmissions);
      // Should detect as multi-select (has arrays)
      expect(result.totalResponses).toBe(3); // All submissions counted (empty array is still a response)
      expect(result.optionCounts).toBeDefined();
    });

    test('should handle checkbox with mixed data types in first 10', () => {
      const field = { id: 'features', label: 'Features', type: 'checkbox' };
      // Mix of arrays and non-arrays - first array should trigger multi-select detection
      const submissions = createSubmissions('features', [
        true, // Boolean
        false, // Boolean
        ['Feature A'], // Array - should trigger multi-select
        true
      ]);
      const totalSubmissions = 4;

      const result = analyzeCheckboxField(field, submissions, totalSubmissions);
      // Should detect as multi-select because of array in first 10
      expect(result.optionCounts).toBeDefined();
      expect(result.averageSelections).toBeDefined();
    });

    test('should handle date field with various date formats', () => {
      const field = { id: 'appointment', label: 'Appointment Date', type: 'date' };
      const submissions = createSubmissions('appointment', [
        '2024-01-15', // ISO date string
        new Date('2024-01-16').toISOString(), // Full ISO string
        '2024-01-17T00:00:00.000Z' // ISO with time
      ]);
      const totalSubmissions = 3;

      const result = analyzeDateField(field, submissions, totalSubmissions);
      expect(result.totalResponses).toBe(3);
      expect(result.distribution).toBeDefined();
    });
  });
});
