/**
 * Compare extracted fields against expected form fields
 */

const fs = require('fs')

// Expected fields from the form (122 fields)
const expectedFields = [
  { label: 'Name', type: 'text' },
  { label: 'Home Address', type: 'text' },
  { label: 'Phone (Home)', type: 'tel' },
  { label: 'Phone (Work)', type: 'tel' },
  { label: 'Phone (Cell)', type: 'tel' },
  { label: 'Phone (Other, please specify)', type: 'tel', allowOther: true },
  { label: 'Email', type: 'email' },
  { label: 'Emergency Contact (Name)', type: 'text' },
  { label: 'Emergency Contact (Phone)', type: 'tel' },
  { label: 'Emergency Contact (Relationship)', type: 'text' },
  { label: 'Reimbursement', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, is it OK to email statements to you?', type: 'radio', options: ['Yes', 'No', 'please mail it to my home address', 'Other'] },
  { label: '1. Age', type: 'text' },
  { label: '2. Date of birth', type: 'date' },
  { label: '3. Gender', type: 'text' },
  { label: '4. Ethnicity (circle all that apply)', type: 'checkbox', options: ['Caucasian', 'Black/African-American', 'Hispanic', 'South Asian', 'Middle Eastern', 'East Asian', 'Southeast Asian', 'Native American', 'Pacific Islander', 'Other'] },
  { label: '5. Religious background (circle one)', type: 'radio', options: ['Protestant', 'Catholic', 'Jewish', 'Muslim', 'Hindu', 'Buddhist', 'No Affiliation', 'Other'] },
  { label: '6. What is your sexual orientation?', type: 'text' },
  { label: '7. Marital status', type: 'radio', options: ['Single, never married', 'Cohabiting', 'Married', 'Widowed', 'Divorced', 'Separated', 'Other'] },
  { label: '8. If you have a partner or spouse, how long have you been together?', type: 'text' },
  { label: '9. If you have a partner or spouse, what is your spouse/partner\'s occupation?', type: 'text' },
  { label: '10. If divorced, when did you divorce and how long were you married?', type: 'text' },
  { label: '11. If you are widowed, when and how did your spouse die?', type: 'text' },
  { label: '12. If applicable, please list names and ages of your children', type: 'textarea' },
  { label: '13. Names of persons living in your home and your relationship to them', type: 'textarea' },
  { label: '1. Mother\'s First Name', type: 'text' },
  { label: '1. Mother\'s Biological parent?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'Where was she born?', type: 'text' },
  { label: 'If living, age and health status', type: 'text' },
  { label: 'If living, where does she live now?', type: 'text' },
  { label: 'If deceased, year and cause of death', type: 'text' },
  { label: '2. Father\'s First Name', type: 'text' },
  { label: '2. Father\'s Biological parent?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'Where was he born?', type: 'text' },
  { label: 'If living, age and health status', type: 'text' },
  { label: 'If living, where does he live now?', type: 'text' },
  { label: 'If deceased, year and cause of death', type: 'text' },
  { label: '3. Did your parents marry?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '4. Did your parents separate or divorce?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, when?', type: 'text' },
  { label: '5. With whom did you primarily live while growing up?', type: 'text' },
  { label: '6. Siblings', type: 'textarea' },
  { label: '7. Where were you born?', type: 'text' },
  { label: '8. Where did you grow up?', type: 'text' },
  { label: '9. Is English your first language?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If no, please specify first language', type: 'text' },
  { label: '1. Are you going to school now?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, Full-time/Part-time', type: 'radio', options: ['Full-time', 'Part-time', 'Other'] },
  { label: 'If yes, what are you studying?', type: 'text' },
  { label: '2. Number of years of education completed', type: 'text' },
  { label: '3. What is your highest degree and when did you earn it?', type: 'text' },
  { label: '4. Did you ever leave a school you were enrolled in prior to completion?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, give details', type: 'textarea' },
  { label: '5. Did you ever receive any special education services?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, give details', type: 'textarea' },
  { label: '6. Are you working now?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, Full-time/Part-time', type: 'radio', options: ['Full-time', 'Part-time', 'Other'] },
  { label: '7. Recent Employment history', type: 'textarea' },
  { label: '9. Are you receiving or have you ever received medical or disability benefits?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, give details', type: 'textarea' },
  { label: '1. Please describe briefly what brings you in to see me', type: 'textarea' },
  { label: 'a. When did you start having these problems?', type: 'text' },
  { label: 'b. Have you ever had problems like this before?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, when?', type: 'text' },
  { label: '2. Are you currently seeing another therapist/psychiatrist?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please provide the following info', type: 'textarea' },
  { label: '3. Have you previously been in therapy or counseling?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please provide the following information', type: 'textarea' },
  { label: '4. Has a health professional ever recommended hospitalization?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '5. Have you ever been hospitalized in an inpatient or partial hospitalization program?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please complete the following chart', type: 'textarea' },
  { label: '6. Do you currently take medications to treat mental/emotional difficulties?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please complete the following chart', type: 'textarea' },
  { label: '7. Are you currently involved in any other activities to help with your symptoms?', type: 'textarea' },
  { label: '8. Do you currently take any herbal supplements or medicines?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, what do you take?', type: 'text' },
  { label: '9. Please list medications you have taken previously to treat mental or emotional difficulties', type: 'textarea' },
  { label: '10. Have you ever made a suicide attempt?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '11. Have you ever purposely harmed yourself?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '12. Do any biological relatives have any history of psychiatric, emotional and/or substance use problems?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, which family members and what types of problems?', type: 'textarea' },
  { label: '1. Do you now have, or have you had in the past, any serious, chronic or recurrent health problems or disabilities?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please describe', type: 'textarea' },
  { label: '2. Are you currently taking medications for any physical health problems?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please complete the following chart', type: 'textarea' },
  { label: '3. List dates of any hospitalizations for physical problems', type: 'textarea' },
  { label: '4. When was your last physical examination by a physician?', type: 'text' },
  { label: 'What was the outcome?', type: 'textarea' },
  { label: '5. Do you exercise?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, how often?', type: 'text' },
  { label: '1. Do you smoke cigarettes?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, how much do you smoke?', type: 'text' },
  { label: '2. Do you drink caffeinated beverages?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, how many cups daily?', type: 'text' },
  { label: '3. Have you ever used any drugs or medications other than as prescribed?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'Are you currently using?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please complete the following', type: 'textarea' },
  { label: '4. If you have used any substances listed above, do you feel they have caused any problems?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please explain', type: 'textarea' },
  { label: '5. Do you drink alcohol?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, how much do you drink?', type: 'text' },
  { label: 'Do you feel your drinking has caused any problems?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please explain', type: 'textarea' },
  { label: 'Have you ever been treated for drug or alcohol abuse?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please describe the provider/program, give dates and describe the outcome', type: 'textarea' },
  { label: '1. Have you ever had a physical fight with anyone?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '2. Did you ever have sexual contact with someone that you did not want?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '3. Have you experienced or witnessed any traumas?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '4. Have you experienced physical or sexual abuse or assault?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: '1. Have you ever been involved in a lawsuit?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please describe the circumstances and give dates', type: 'textarea' },
  { label: '2. Have you ever been arrested?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please describe the circumstances and give dates', type: 'textarea' },
  { label: '3. Have you experienced any particular sources of stress in the last year?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please explain', type: 'textarea' },
  { label: '4. Are there any other health care professionals who have information that might help in your treatment?', type: 'radio', options: ['Yes', 'No', 'Other'] },
  { label: 'If yes, please provide that person\'s name and contact information', type: 'textarea' },
  { label: '5. If there is any other information that would be helpful for me to know, please explain', type: 'textarea' },
  { label: 'Signature', type: 'text' },
  { label: 'Date', type: 'date' }
]

// Normalize label for comparison (remove extra spaces, lowercase)
function normalizeLabel(label) {
  return label.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Load extracted fields
const extractedFieldsPath = '/tmp/extracted_fields.json'
if (!fs.existsSync(extractedFieldsPath)) {
  console.error('❌ Extracted fields file not found. Please run the test first.')
  process.exit(1)
}

const extractedFields = JSON.parse(fs.readFileSync(extractedFieldsPath, 'utf8'))

console.log('📊 FIELD COMPARISON ANALYSIS\n')
console.log('='.repeat(80))
console.log(`Expected fields: ${expectedFields.length}`)
console.log(`Extracted fields: ${extractedFields.length}`)
console.log(`Difference: ${extractedFields.length - expectedFields.length}\n`)

// Create normalized maps for comparison
const expectedMap = new Map()
expectedFields.forEach(field => {
  const normalized = normalizeLabel(field.label)
  if (!expectedMap.has(normalized)) {
    expectedMap.set(normalized, [])
  }
  expectedMap.get(normalized).push(field)
})

const extractedMap = new Map()
extractedFields.forEach(field => {
  const normalized = normalizeLabel(field.label)
  if (!extractedMap.has(normalized)) {
    extractedMap.set(normalized, [])
  }
  extractedMap.get(normalized).push(field)
})

// Find matches, missing, and extra
const matched = []
const missing = []
const extra = []

expectedFields.forEach(expected => {
  const normalized = normalizeLabel(expected.label)
  if (extractedMap.has(normalized)) {
    matched.push({ expected, extracted: extractedMap.get(normalized) })
  } else {
    missing.push(expected)
  }
})

extractedFields.forEach(extracted => {
  const normalized = normalizeLabel(extracted.label)
  if (!expectedMap.has(normalized)) {
    extra.push(extracted)
  }
})

console.log('✅ MATCHED FIELDS:', matched.length)
console.log('❌ MISSING FIELDS:', missing.length)
console.log('➕ EXTRA FIELDS:', extra.length)
console.log('\n' + '='.repeat(80))

if (missing.length > 0) {
  console.log('\n❌ MISSING FIELDS:')
  console.log('─'.repeat(80))
  missing.forEach((field, i) => {
    console.log(`${i + 1}. ${field.label} (${field.type})`)
  })
}

if (extra.length > 0) {
  console.log('\n➕ EXTRA FIELDS (not in expected list):')
  console.log('─'.repeat(80))
  extra.forEach((field, i) => {
    console.log(`${i + 1}. ${field.label} (${field.type}, page ${field.pageNumber || 'N/A'})`)
    if (field.options && field.options.length > 0) {
      console.log(`   Options: ${field.options.slice(0, 3).join(', ')}${field.options.length > 3 ? '...' : ''}`)
    }
  })
}

// Check for similar labels (fuzzy matching)
console.log('\n🔍 POTENTIAL LABEL VARIATIONS:')
console.log('─'.repeat(80))
const similarMatches = []
missing.forEach(missingField => {
  const missingNormalized = normalizeLabel(missingField.label)
  extractedFields.forEach(extracted => {
    const extractedNormalized = normalizeLabel(extracted.label)
    // Check if labels are similar (contain key words)
    const missingWords = missingNormalized.split(' ').filter(w => w.length > 3)
    const extractedWords = extractedNormalized.split(' ').filter(w => w.length > 3)
    const commonWords = missingWords.filter(w => extractedWords.includes(w))
    
    if (commonWords.length >= 2 && commonWords.length >= missingWords.length * 0.5) {
      similarMatches.push({
        expected: missingField.label,
        extracted: extracted.label,
        commonWords: commonWords.join(', ')
      })
    }
  })
})

if (similarMatches.length > 0) {
  similarMatches.slice(0, 10).forEach((match, i) => {
    console.log(`${i + 1}. Expected: "${match.expected}"`)
    console.log(`   Found: "${match.extracted}"`)
    console.log(`   Common: ${match.commonWords}\n`)
  })
} else {
  console.log('No similar matches found')
}

console.log('\n' + '='.repeat(80))
console.log('✅ ANALYSIS COMPLETE')
console.log('='.repeat(80))

