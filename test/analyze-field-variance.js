/**
 * Analyze field extraction variance across multiple test runs
 * 
 * Usage:
 *   node test/analyze-field-variance.js test-results-{timestamp}.json
 */

const fs = require('fs')
const path = require('path')

const resultsFile = process.argv[2]

if (!resultsFile) {
  console.error('❌ Please provide results JSON file path')
  console.error('Usage: node test/analyze-field-variance.js test-results-{timestamp}.json')
  process.exit(1)
}

if (!fs.existsSync(resultsFile)) {
  console.error(`❌ Results file not found: ${resultsFile}`)
  process.exit(1)
}

// Load results
const data = JSON.parse(fs.readFileSync(resultsFile, 'utf8'))
const results = data.results || []
const numRuns = data.testConfiguration?.numRuns || results.length

if (results.length === 0) {
  console.error('❌ No successful runs found in results file')
  process.exit(1)
}

console.log(`\n📊 Analyzing ${results.length} successful runs out of ${numRuns} total runs\n`)

// Create field signature for matching fields across runs
function escapeSignature(str) {
  // Escape pipe characters to prevent signature collisions
  return (str || '').replace(/\|/g, '\\|')
}

function createFieldSignature(field) {
  const type = field.type || 'unknown'
  const pageNumber = field.pageNumber || 1
  
  // For label fields (empty label), use type + pageNumber + first 50 chars of richTextContent
  if (type === 'label' && (!field.label || field.label.trim() === '')) {
    const content = field.richTextContent || ''
    const contentPreview = content.substring(0, 50).replace(/\s+/g, ' ').trim()
    return `${type}|${pageNumber}|${escapeSignature(contentPreview)}`
  }
  
  // For regular fields, use label + type + pageNumber
  const label = (field.label || '').trim()
  return `${escapeSignature(label)}|${type}|${pageNumber}`
}

// Collect all fields with their signatures
const fieldMap = new Map() // signature -> { field data, appearances: [run numbers] }

results.forEach((result, runIndex) => {
  const fields = result.fields || []
  
  fields.forEach(field => {
    const signature = createFieldSignature(field)
    
    if (!fieldMap.has(signature)) {
      fieldMap.set(signature, {
        signature,
        field: { ...field },
        appearances: [],
        runNumbers: []
      })
    }
    
    const entry = fieldMap.get(signature)
    entry.appearances.push(runIndex + 1)
    entry.runNumbers.push(result.run || runIndex + 1)
  })
})

// Categorize fields by stability
const stabilityCategories = {
  stable: [],      // 100% (appears in all runs)
  mostlyStable: [], // 80% (appears in 4/5 runs)
  somewhatStable: [], // 60% (appears in 3/5 runs)
  unstable: [],    // 40% (appears in 2/5 runs)
  veryUnstable: [], // 20% (appears in 1/5 runs)
  neverExtracted: [] // 0% (never appears - this would be from a reference set)
}

fieldMap.forEach((entry, signature) => {
  const appearanceCount = entry.appearances.length
  const stability = (appearanceCount / numRuns) * 100
  
  entry.stability = stability
  entry.appearanceCount = appearanceCount
  
  if (stability === 100) {
    stabilityCategories.stable.push(entry)
  } else if (stability >= 80) {
    stabilityCategories.mostlyStable.push(entry)
  } else if (stability >= 60) {
    stabilityCategories.somewhatStable.push(entry)
  } else if (stability >= 40) {
    stabilityCategories.unstable.push(entry)
  } else {
    stabilityCategories.veryUnstable.push(entry)
  }
})

// Analyze by field type
const typeAnalysis = {}
fieldMap.forEach(entry => {
  const type = entry.field.type || 'unknown'
  if (!typeAnalysis[type]) {
    typeAnalysis[type] = {
      total: 0,
      stable: 0,
      mostlyStable: 0,
      somewhatStable: 0,
      unstable: 0,
      veryUnstable: 0,
      avgStability: 0,
      fields: []
    }
  }
  
  const analysis = typeAnalysis[type]
  analysis.total++
  analysis.fields.push(entry)
  
  if (entry.stability === 100) analysis.stable++
  else if (entry.stability >= 80) analysis.mostlyStable++
  else if (entry.stability >= 60) analysis.somewhatStable++
  else if (entry.stability >= 40) analysis.unstable++
  else analysis.veryUnstable++
})

// Calculate average stability per type
Object.keys(typeAnalysis).forEach(type => {
  const analysis = typeAnalysis[type]
  if (analysis.fields.length > 0) {
    analysis.avgStability = analysis.fields.reduce((sum, f) => sum + f.stability, 0) / analysis.fields.length
  }
})

// Analyze by page number
const pageAnalysis = {}
fieldMap.forEach(entry => {
  const page = entry.field.pageNumber || 1
  if (!pageAnalysis[page]) {
    pageAnalysis[page] = {
      total: 0,
      stable: 0,
      avgStability: 0,
      fields: []
    }
  }
  
  const analysis = pageAnalysis[page]
  analysis.total++
  analysis.fields.push(entry)
  if (entry.stability === 100) analysis.stable++
})

Object.keys(pageAnalysis).forEach(page => {
  const analysis = pageAnalysis[page]
  if (analysis.fields.length > 0) {
    analysis.avgStability = analysis.fields.reduce((sum, f) => sum + f.stability, 0) / analysis.fields.length
  }
})

// Analyze conditional questions
const conditionalFields = []
fieldMap.forEach(entry => {
  const label = (entry.field.label || '').toLowerCase()
  if (label.includes('if yes') || label.includes('if no') || label.includes('if applicable')) {
    conditionalFields.push(entry)
  }
})

// Analyze label fields
const labelFields = []
fieldMap.forEach(entry => {
  if (entry.field.type === 'label') {
    labelFields.push(entry)
  }
})

// Generate report
const reportPath = path.join(__dirname, '../plan/FIELD_EXTRACTION_CONSISTENCY_REPORT.md')
const report = []

report.push('# Field Extraction Consistency Report')
report.push('')
report.push(`**Generated**: ${new Date().toISOString()}`)
report.push(`**Test Configuration**:`)
report.push(`- Number of runs: ${numRuns}`)
report.push(`- Successful runs: ${results.length}`)
report.push(`- Failed runs: ${data.errors?.length || 0}`)
report.push(`- PDF: ${data.testConfiguration?.pdfPath || 'Unknown'}`)
report.push(`- Railway URL: ${data.testConfiguration?.railwayUrl || 'Unknown'}`)
report.push('')

// Summary Statistics
report.push('## Summary Statistics')
report.push('')
report.push(`- **Total unique fields found**: ${fieldMap.size}`)
report.push(`- **Field count range**: ${data.summary?.minFieldCount || 0} - ${data.summary?.maxFieldCount || 0}`)
report.push(`- **Average field count**: ${data.summary?.avgFieldCount || 0}`)
report.push(`- **Field count variance**: ${data.summary?.maxFieldCount - data.summary?.minFieldCount || 0} fields`)
report.push('')

// Field Stability Breakdown
report.push('## Field Stability Breakdown')
report.push('')
report.push(`- **100% Stable** (appears in all ${numRuns} runs): ${stabilityCategories.stable.length} fields`)
report.push(`- **80%+ Stable** (appears in ${Math.ceil(numRuns * 0.8)}+ runs): ${stabilityCategories.mostlyStable.length} fields`)
report.push(`- **60%+ Stable** (appears in ${Math.ceil(numRuns * 0.6)}+ runs): ${stabilityCategories.somewhatStable.length} fields`)
report.push(`- **40%+ Stable** (appears in ${Math.ceil(numRuns * 0.4)}+ runs): ${stabilityCategories.unstable.length} fields`)
report.push(`- **<40% Stable** (appears in <${Math.ceil(numRuns * 0.4)} runs): ${stabilityCategories.veryUnstable.length} fields`)
report.push('')

// Field Type Analysis
report.push('## Field Type Analysis')
report.push('')
report.push('| Type | Total | 100% Stable | 80%+ Stable | 60%+ Stable | <60% Stable | Avg Stability |')
report.push('|------|-------|------------|-------------|-------------|-------------|---------------|')
Object.entries(typeAnalysis)
  .sort((a, b) => b[1].total - a[1].total)
  .forEach(([type, analysis]) => {
    const stable = analysis.stable
    const mostlyStable = analysis.mostlyStable
    const somewhatStable = analysis.somewhatStable
    const lessStable = analysis.unstable + analysis.veryUnstable
    report.push(`| ${type} | ${analysis.total} | ${stable} | ${mostlyStable} | ${somewhatStable} | ${lessStable} | ${analysis.avgStability.toFixed(1)}% |`)
  })
report.push('')

// Page Analysis
report.push('## Page-by-Page Analysis')
report.push('')
report.push('| Page | Total Fields | 100% Stable | Avg Stability |')
report.push('|------|-------------|-------------|---------------|')
Object.entries(pageAnalysis)
  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([page, analysis]) => {
    report.push(`| ${page} | ${analysis.total} | ${analysis.stable} | ${analysis.avgStability.toFixed(1)}% |`)
  })
report.push('')

// Conditional Questions Analysis
report.push('## Conditional Questions Analysis')
report.push('')
report.push(`- **Total conditional fields**: ${conditionalFields.length}`)
if (conditionalFields.length > 0) {
  const conditionalStable = conditionalFields.filter(f => f.stability === 100).length
  const conditionalAvgStability = conditionalFields.reduce((sum, f) => sum + f.stability, 0) / conditionalFields.length
  report.push(`- **100% Stable**: ${conditionalStable} (${((conditionalStable / conditionalFields.length) * 100).toFixed(1)}%)`)
  report.push(`- **Average stability**: ${conditionalAvgStability.toFixed(1)}%`)
}
report.push('')

// Label Fields Analysis
report.push('## Label Fields Analysis')
report.push('')
report.push(`- **Total label fields**: ${labelFields.length}`)
if (labelFields.length > 0) {
  const labelStable = labelFields.filter(f => f.stability === 100).length
  const labelAvgStability = labelFields.reduce((sum, f) => sum + f.stability, 0) / labelFields.length
  report.push(`- **100% Stable**: ${labelStable} (${((labelStable / labelFields.length) * 100).toFixed(1)}%)`)
  report.push(`- **Average stability**: ${labelAvgStability.toFixed(1)}%`)
}
report.push('')

// Inconsistent Fields (appearing in <80% of runs)
const inconsistentFields = [
  ...stabilityCategories.somewhatStable,
  ...stabilityCategories.unstable,
  ...stabilityCategories.veryUnstable
].sort((a, b) => a.stability - b.stability)

if (inconsistentFields.length > 0) {
  report.push('## Inconsistent Fields (<80% stability)')
  report.push('')
  report.push(`**Total**: ${inconsistentFields.length} fields`)
  report.push('')
  report.push('| Stability | Label | Type | Page | Appears in Runs |')
  report.push('|-----------|-------|------|------|-----------------|')
  inconsistentFields.slice(0, 50).forEach(entry => {
    const label = entry.field.label || (entry.field.type === 'label' ? `[Label: ${(entry.field.richTextContent || '').substring(0, 40)}...]` : '[No label]')
    const type = entry.field.type || 'unknown'
    const page = entry.field.pageNumber || 1
    const runs = entry.runNumbers.join(', ')
    report.push(`| ${entry.stability.toFixed(0)}% | ${label.substring(0, 40)} | ${type} | ${page} | ${runs} |`)
  })
  if (inconsistentFields.length > 50) {
    report.push(`\n*... and ${inconsistentFields.length - 50} more inconsistent fields*`)
  }
  report.push('')
}

// Token Usage Analysis
if (results.some(r => r.reasoningTokens !== null && r.reasoningTokens !== undefined)) {
  report.push('## Token Usage Analysis')
  report.push('')
  const reasoningTokens = results.map(r => r.reasoningTokens).filter(t => t !== null && t !== undefined)
  const outputTokens = results.map(r => r.analytics?.groqApi?.outputTokens).filter(t => t !== null && t !== undefined)
  
  if (reasoningTokens.length > 0) {
    const avgReasoning = Math.round(reasoningTokens.reduce((a, b) => a + b, 0) / reasoningTokens.length)
    const minReasoning = Math.min(...reasoningTokens)
    const maxReasoning = Math.max(...reasoningTokens)
    report.push(`- **Reasoning tokens**:`)
    report.push(`  - Average: ${avgReasoning.toLocaleString()}`)
    report.push(`  - Range: ${minReasoning.toLocaleString()} - ${maxReasoning.toLocaleString()}`)
    report.push(`  - Variance: ${maxReasoning - minReasoning} tokens`)
    
    if (outputTokens.length > 0) {
      const avgOutput = Math.round(outputTokens.reduce((a, b) => a + b, 0) / outputTokens.length)
      const reasoningPercentage = ((avgReasoning / avgOutput) * 100).toFixed(1)
      report.push(`- **Reasoning tokens as % of output**: ${reasoningPercentage}%`)
    }
  }
  report.push('')
}

// Recommendations
report.push('## Recommendations')
report.push('')
if (stabilityCategories.veryUnstable.length > 0 || stabilityCategories.unstable.length > 0) {
  report.push('### High Priority')
  report.push(`- ${stabilityCategories.veryUnstable.length + stabilityCategories.unstable.length} fields have <60% stability`)
  report.push('- Consider reviewing prompt to emphasize extraction of these field types')
  report.push('')
}

if (conditionalFields.length > 0 && conditionalFields.filter(f => f.stability < 80).length > 0) {
  report.push('### Conditional Questions')
  report.push('- Some conditional questions are inconsistently extracted')
  report.push('- Review prompt instructions for conditional question handling')
  report.push('')
}

if (labelFields.length > 0 && labelFields.filter(f => f.stability < 80).length > 0) {
  report.push('### Label Fields')
  report.push('- Some label fields (titles, headers, instructions) are inconsistently extracted')
  report.push('- Review prompt instructions for label field extraction')
  report.push('')
}

const lowStabilityTypes = Object.entries(typeAnalysis)
  .filter(([type, analysis]) => analysis.avgStability < 80)
  .sort((a, b) => a[1].avgStability - b[1].avgStability)

if (lowStabilityTypes.length > 0) {
  report.push('### Field Types with Low Stability')
  report.push('The following field types have average stability <80%:')
  lowStabilityTypes.forEach(([type, analysis]) => {
    report.push(`- **${type}**: ${analysis.avgStability.toFixed(1)}% (${analysis.total} fields)`)
  })
  report.push('')
}

report.push('### General Recommendations')
report.push('- Monitor field extraction consistency in production')
report.push('- Consider implementing field validation/verification step')
report.push('- Review if variance is acceptable for your use case')
report.push('')

// Write report
const reportDir = path.dirname(reportPath)
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true })
}

fs.writeFileSync(reportPath, report.join('\n'))
console.log(`✅ Analysis complete!`)
console.log(`📄 Report saved to: ${reportPath}`)
console.log(`\n📊 Quick Summary:`)
console.log(`   Total unique fields: ${fieldMap.size}`)
console.log(`   100% Stable: ${stabilityCategories.stable.length}`)
console.log(`   <80% Stable: ${inconsistentFields.length}`)
console.log(`   Field count range: ${data.summary?.minFieldCount || 0} - ${data.summary?.maxFieldCount || 0}`)

