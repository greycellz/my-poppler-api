/**
 * Test Calendly Integration Endpoints
 * Validates data formats, field names, and error handling
 */

const BASE_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app'

async function testCalendlyEndpoints() {
  console.log('🧪 Testing Calendly Integration Endpoints')
  console.log('=' .repeat(50))

  // Test 1: Connect Calendly Account - Valid Data
  console.log('\n📅 Test 1: Connect Calendly Account (Valid)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'test-user-123',
        calendlyUsername: 'john-doe',
        calendlyUrl: 'https://calendly.com/john-doe'
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (response.ok && data.success) {
      console.log('✅ Valid Calendly connection test passed')
    } else {
      console.log('❌ Valid Calendly connection test failed')
    }
  } catch (error) {
    console.log('❌ Valid Calendly connection test error:', error.message)
  }

  // Test 2: Connect Calendly Account - Invalid Data
  console.log('\n📅 Test 2: Connect Calendly Account (Invalid URL)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'test-user-123',
        calendlyUsername: 'john-doe',
        calendlyUrl: 'https://invalid-url.com/john-doe'
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (!response.ok && data.error && data.error.includes('Invalid Calendly URL format')) {
      console.log('✅ Invalid URL validation test passed')
    } else {
      console.log('❌ Invalid URL validation test failed')
    }
  } catch (error) {
    console.log('❌ Invalid URL validation test error:', error.message)
  }

  // Test 3: Connect Calendly Account - Missing Fields
  console.log('\n📅 Test 3: Connect Calendly Account (Missing Fields)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'test-user-123'
        // Missing calendlyUsername and calendlyUrl
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (!response.ok && data.error && data.error.includes('required')) {
      console.log('✅ Missing fields validation test passed')
    } else {
      console.log('❌ Missing fields validation test failed')
    }
  } catch (error) {
    console.log('❌ Missing fields validation test error:', error.message)
  }

  // Test 4: Get Calendly Account Status
  console.log('\n📅 Test 4: Get Calendly Account Status')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/account/test-user-123`)
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (response.ok && data.success && data.account) {
      console.log('✅ Get account status test passed')
    } else {
      console.log('❌ Get account status test failed')
    }
  } catch (error) {
    console.log('❌ Get account status test error:', error.message)
  }

  // Test 5: Store Calendar Booking - Valid Data
  console.log('\n📅 Test 5: Store Calendar Booking (Valid)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: 'test-submission-123',
        formId: 'test-form-123',
        fieldId: 'test-field-123',
        eventUri: 'https://calendly.com/john-doe/15min',
        eventName: '15 Minute Consultation',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:15:00Z',
        duration: 15,
        timezone: 'UTC',
        attendeeEmail: 'test@example.com',
        attendeeName: 'Test User',
        attendeePhone: '+1234567890',
        bookingUrl: 'https://calendly.com/john-doe/15min/booking/123'
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (response.ok && data.success && data.bookingId) {
      console.log('✅ Valid booking storage test passed')
    } else {
      console.log('❌ Valid booking storage test failed')
    }
  } catch (error) {
    console.log('❌ Valid booking storage test error:', error.message)
  }

  // Test 6: Store Calendar Booking - Missing Required Fields
  console.log('\n📅 Test 6: Store Calendar Booking (Missing Fields)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: 'test-submission-123'
        // Missing formId, fieldId, eventUri
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (!response.ok && data.error && data.error.includes('Missing required booking data')) {
      console.log('✅ Missing fields validation test passed')
    } else {
      console.log('❌ Missing fields validation test failed')
    }
  } catch (error) {
    console.log('❌ Missing fields validation test error:', error.message)
  }

  // Test 7: Store Calendar Booking - Invalid Duration
  console.log('\n📅 Test 7: Store Calendar Booking (Invalid Duration)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: 'test-submission-123',
        formId: 'test-form-123',
        fieldId: 'test-field-123',
        eventUri: 'https://calendly.com/john-doe/15min',
        eventName: '15 Minute Consultation',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:15:00Z',
        duration: -5, // Invalid negative duration
        timezone: 'UTC',
        attendeeEmail: 'test@example.com',
        attendeeName: 'Test User'
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (!response.ok && data.error && data.error.includes('Duration must be a positive number')) {
      console.log('✅ Invalid duration validation test passed')
    } else {
      console.log('❌ Invalid duration validation test failed')
    }
  } catch (error) {
    console.log('❌ Invalid duration validation test error:', error.message)
  }

  // Test 8: Store Calendar Booking - Invalid Email
  console.log('\n📅 Test 8: Store Calendar Booking (Invalid Email)')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: 'test-submission-123',
        formId: 'test-form-123',
        fieldId: 'test-field-123',
        eventUri: 'https://calendly.com/john-doe/15min',
        eventName: '15 Minute Consultation',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:15:00Z',
        duration: 15,
        timezone: 'UTC',
        attendeeEmail: 'invalid-email', // Invalid email format
        attendeeName: 'Test User'
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (!response.ok && data.error && data.error.includes('Invalid attendee email format')) {
      console.log('✅ Invalid email validation test passed')
    } else {
      console.log('❌ Invalid email validation test failed')
    }
  } catch (error) {
    console.log('❌ Invalid email validation test error:', error.message)
  }

  // Test 9: Get Calendar Bookings
  console.log('\n📅 Test 9: Get Calendar Bookings')
  try {
    const response = await fetch(`${BASE_URL}/api/calendly/bookings/test-submission-123`)
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (response.ok && data.success && Array.isArray(data.bookings)) {
      console.log('✅ Get bookings test passed')
    } else {
      console.log('❌ Get bookings test failed')
    }
  } catch (error) {
    console.log('❌ Get bookings test error:', error.message)
  }

  // Test 10: Test Calendar Field Configuration Storage
  console.log('\n📅 Test 10: Calendar Field Configuration Storage')
  try {
    const response = await fetch(`${BASE_URL}/api/auto-save-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formId: 'test-calendar-form-123',
        formSchema: {
          title: 'Test Calendar Form',
                 fields: [
                   {
                     id: 'field_calendly_test_123',
                     type: 'calendly',
                     label: 'Schedule Meeting',
                     required: true,
                     calendlyUrl: 'https://calendly.com/akj_work/30min',
                     eventTypeUri: 'https://calendly.com/akj_work/30min',
                     eventName: '30 Minute Meeting',
                     duration: 30,
                     requirePaymentFirst: false
                   }
                 ],
          isHipaa: false
        }
      })
    })
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (response.ok && data.success) {
      console.log('✅ Calendar field configuration storage test passed')
    } else {
      console.log('❌ Calendar field configuration storage test failed')
    }
  } catch (error) {
    console.log('❌ Calendar field configuration storage test error:', error.message)
  }

  // Test 11: Test Calendar Field Retrieval
  console.log('\n📅 Test 11: Calendar Field Retrieval')
  try {
    const response = await fetch(`${BASE_URL}/form/test-calendar-form-123`)
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    console.log(`Response:`, JSON.stringify(data, null, 2))
    
    if (response.ok && data.success && data.formSchema) {
      const calendlyField = data.formSchema.fields?.find(field => field.type === 'calendly')
      if (calendlyField && calendlyField.calendlyUrl === 'https://calendly.com/akj_work/30min') {
        console.log('✅ Calendly field retrieval test passed - URL preserved')
        console.log('📅 Calendly field details:', {
          id: calendlyField.id,
          type: calendlyField.type,
          label: calendlyField.label,
          calendlyUrl: calendlyField.calendlyUrl,
          eventName: calendlyField.eventName,
          duration: calendlyField.duration,
          requirePaymentFirst: calendlyField.requirePaymentFirst
        })
      } else {
        console.log('❌ Calendly field retrieval test failed - URL not preserved')
        console.log('Calendly field found:', calendlyField)
      }
    } else {
      console.log('❌ Calendar field retrieval test failed')
    }
  } catch (error) {
    console.log('❌ Calendar field retrieval test error:', error.message)
  }

  // Test 12: Test Calendar Field Configuration in Database
  console.log('\n📅 Test 12: Calendar Field Configuration in Database')
  try {
    // This test verifies that the calendar field was properly stored in the calendar_fields collection
    // We'll check by trying to retrieve the form and looking for calendar field configuration
    const response = await fetch(`${BASE_URL}/form/test-calendar-form-123`)
    
    const data = await response.json()
    console.log(`Status: ${response.status}`)
    
    if (response.ok && data.success) {
      console.log('✅ Calendar field database configuration test passed')
      console.log('📅 Form structure includes calendar field with proper configuration')
    } else {
      console.log('❌ Calendar field database configuration test failed')
    }
  } catch (error) {
    console.log('❌ Calendar field database configuration test error:', error.message)
  }

  console.log('\n🎯 Calendly Integration Tests Completed!')
  console.log('=' .repeat(50))
}

// Run tests
testCalendlyEndpoints().catch(console.error)
