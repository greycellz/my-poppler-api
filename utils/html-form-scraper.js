/**
 * HTML Form Scraper Utility
 * Extracts form fields from a rendered HTML page using Puppeteer DOM access
 * 
 * This provides more accurate field extraction than Vision API for web forms
 * by directly accessing the DOM structure.
 */

/**
 * Extract form fields from a Puppeteer page
 * @param {Page} page - Puppeteer page object
 * @returns {Promise<Array>} Array of extracted form fields
 */
async function extractFormFieldsFromDOM(page) {
  console.log('🔍 Extracting form fields from DOM...')
  
  const fields = await page.evaluate(() => {
    const extractedFields = []
    const processedRadioGroups = new Set()
    const processedCheckboxGroups = new Set()
    const processedInputIds = new Set()
    
    // Helper function to find main question label for a field group
    const findMainQuestionLabel = (element) => {
      // Look for a label element that's a parent or preceding sibling
      // This should be the main question, not the option label
      
      let current = element.parentElement
      let depth = 0
      const maxDepth = 5
      
      while (current && depth < maxDepth) {
        // Check if current element has a label child that comes before the input
        const labels = current.querySelectorAll('label')
        for (const label of labels) {
          // Skip labels that contain radio/checkbox inputs (those are option labels)
          if (label.querySelector('input[type="radio"], input[type="checkbox"]')) {
            continue
          }
          
          // Check if this label is before the element in DOM order
          const children = Array.from(current.children)
          const labelIndex = children.indexOf(label)
          const elementIndex = children.indexOf(element.closest('div') || element)
          
          if (labelIndex >= 0 && (elementIndex < 0 || labelIndex < elementIndex)) {
            const labelClone = label.cloneNode(true)
            // Remove any nested inputs/buttons from label
            labelClone.querySelectorAll('input, button, span[style*="color: #ef4444"]').forEach(el => el.remove())
            const text = labelClone.textContent?.trim() || ''
            if (text && text.length > 0) {
              return text.replace(/\s*\*+\s*$/, '').trim()
            }
          }
        }
        
        // Also check for label as previous sibling
        let prevSibling = current.previousElementSibling
        while (prevSibling) {
          if (prevSibling.tagName === 'LABEL') {
            // Skip if it contains radio/checkbox
            if (!prevSibling.querySelector('input[type="radio"], input[type="checkbox"]')) {
              const labelClone = prevSibling.cloneNode(true)
              labelClone.querySelectorAll('input, button, span[style*="color: #ef4444"]').forEach(el => el.remove())
              const text = labelClone.textContent?.trim() || ''
              if (text && text.length > 0) {
                return text.replace(/\s*\*+\s*$/, '').trim()
              }
            }
          }
          prevSibling = prevSibling.previousElementSibling
        }
        
        current = current.parentElement
        depth++
      }
      
      return null
    }
    
    // Helper function to extract label text and check for required indicator
    const extractLabelText = (labelElement) => {
      if (!labelElement) return { text: '', required: false }
      
      const labelClone = labelElement.cloneNode(true)
      const hasAsterisk = labelClone.textContent?.includes('*')
      const requiredSpan = labelClone.querySelector('span[style*="color: #ef4444"], span[style*="color:#ef4444"]')
      const isFieldRequired = hasAsterisk || !!requiredSpan
      
      labelClone.querySelectorAll('span[style*="color: #ef4444"], span[style*="color:#ef4444"]').forEach(el => el.remove())
      let text = labelClone.textContent?.trim() || ''
      text = text.replace(/\s*\*+\s*$/, '').trim()
      
      return { text, required: isFieldRequired }
    }
    
    // First pass: Process radio and checkbox groups
    const allRadios = document.querySelectorAll('input[type="radio"]')
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]')
    
    // Process radio groups
    allRadios.forEach(radio => {
      const radioName = radio.name
      if (!radioName || processedRadioGroups.has(radioName)) return
      
      processedRadioGroups.add(radioName)
      const allRadiosInGroup = document.querySelectorAll(`input[type="radio"][name="${radioName}"]`)
      if (allRadiosInGroup.length === 0) return
      
      // Find main question label
      let mainLabel = findMainQuestionLabel(radio)
      if (!mainLabel) {
        // Fallback: look for label with for attribute or parent label
        const labelId = radio.id || radioName
        const label = document.querySelector(`label[for="${labelId}"]`)
        if (label && !label.querySelector('input[type="radio"]')) {
          const extracted = extractLabelText(label)
          if (extracted.text) {
            mainLabel = extracted.text
          }
        }
      }
      
      if (!mainLabel) {
        // Last resort: use name or skip
        return
      }
      
      // Extract options
      const radioOptions = []
      let hasOther = false
      let otherLabel = null
      let otherPlaceholder = null
      let isRequired = false
      
      allRadiosInGroup.forEach(radioInput => {
        processedInputIds.add(radioInput.id || radioInput.name)
        
        const radioLabel = radioInput.closest('label')
        let radioText = radioInput.value
        
        if (radioLabel) {
          const labelClone = radioLabel.cloneNode(true)
          const radioInClone = labelClone.querySelector('input[type="radio"]')
          if (radioInClone) {
            radioInClone.remove()
          }
          radioText = labelClone.textContent?.trim() || radioInput.value
        }
        
        // Check required
        if (radioInput.hasAttribute('required')) {
          isRequired = true
        }
        
        // Check if "other" option
        const normalizedRadioText = radioText.toLowerCase().trim()
        const isOtherOption = radioInput.value === 'other' || 
          normalizedRadioText === 'other' ||
          normalizedRadioText === 'other:' ||
          (normalizedRadioText.startsWith('other') && normalizedRadioText.length < 20 && 
           !normalizedRadioText.includes('mother') && !normalizedRadioText.includes('brother') &&
           !normalizedRadioText.includes('father') && !normalizedRadioText.includes('another'))
        
        if (isOtherOption) {
          hasOther = true
          otherLabel = radioText
          const otherInput = radioInput.closest('div')?.querySelector('input[type="text"]')
          if (otherInput) {
            otherPlaceholder = otherInput.placeholder || 'Please specify...'
            processedInputIds.add(otherInput.id || otherInput.name)
          }
        } else {
          radioOptions.push(radioText)
        }
      })
      
      if (radioOptions.length > 0 || hasOther) {
        extractedFields.push({
          id: radioName,
          label: mainLabel,
          type: hasOther ? 'radio-with-other' : 'radio',
          required: isRequired,
          placeholder: null,
          options: radioOptions.length > 0 ? radioOptions : undefined,
          allowOther: hasOther || undefined,
          otherLabel: otherLabel || undefined,
          otherPlaceholder: otherPlaceholder || undefined
        })
      }
    })
    
    // Process checkbox groups
    allCheckboxes.forEach(checkbox => {
      const checkboxName = checkbox.name
      if (!checkboxName || processedCheckboxGroups.has(checkboxName)) return
      
      processedCheckboxGroups.add(checkboxName)
      const allCheckboxesInGroup = document.querySelectorAll(`input[type="checkbox"][name="${checkboxName}"]`)
      if (allCheckboxesInGroup.length === 0) return
      
      // Find main question label
      let mainLabel = findMainQuestionLabel(checkbox)
      if (!mainLabel) {
        const labelId = checkbox.id || checkboxName
        const label = document.querySelector(`label[for="${labelId}"]`)
        if (label && !label.querySelector('input[type="checkbox"]')) {
          const extracted = extractLabelText(label)
          if (extracted.text) {
            mainLabel = extracted.text
          }
        }
      }
      
      if (!mainLabel) {
        return
      }
      
      // Extract options
      const checkboxOptions = []
      let hasOther = false
      let otherLabel = null
      let otherPlaceholder = null
      let isRequired = false
      
      allCheckboxesInGroup.forEach(checkboxInput => {
        processedInputIds.add(checkboxInput.id || checkboxInput.name)
        
        const checkboxLabel = checkboxInput.closest('label')
        let checkboxText = checkboxInput.value
        
        if (checkboxLabel) {
          const labelClone = checkboxLabel.cloneNode(true)
          const checkboxInClone = labelClone.querySelector('input[type="checkbox"]')
          if (checkboxInClone) {
            checkboxInClone.remove()
          }
          checkboxText = labelClone.textContent?.trim() || checkboxInput.value
        }
        
        if (checkboxInput.hasAttribute('required')) {
          isRequired = true
        }
        
        const normalizedCheckboxText = checkboxText.toLowerCase().trim()
        const isOtherOption = checkboxInput.value === 'other' || 
          normalizedCheckboxText === 'other' ||
          normalizedCheckboxText === 'other:' ||
          (normalizedCheckboxText.startsWith('other') && normalizedCheckboxText.length < 20 && 
           !normalizedCheckboxText.includes('mother') && !normalizedCheckboxText.includes('brother') &&
           !normalizedCheckboxText.includes('father') && !normalizedCheckboxText.includes('another'))
        
        if (isOtherOption) {
          hasOther = true
          otherLabel = checkboxText
          const otherInput = checkboxInput.closest('div')?.querySelector('input[type="text"]')
          if (otherInput) {
            otherPlaceholder = otherInput.placeholder || 'Please specify...'
            processedInputIds.add(otherInput.id || otherInput.name)
          }
        } else {
          checkboxOptions.push(checkboxText)
        }
      })
      
      // Only add one checkbox field per group (avoid duplicates)
      if (checkboxOptions.length > 0 || hasOther) {
        extractedFields.push({
          id: checkboxName,
          label: mainLabel,
          type: hasOther ? 'checkbox-with-other' : 'checkbox',
          required: isRequired,
          placeholder: null,
          options: checkboxOptions.length > 0 ? checkboxOptions : undefined,
          allowOther: hasOther || undefined,
          otherLabel: otherLabel || undefined,
          otherPlaceholder: otherPlaceholder || undefined
        })
      }
    })
    
    // Second pass: Process other form elements (skip radio/checkbox inputs we already processed)
    const formElements = document.querySelectorAll('input, textarea, select')
    
    formElements.forEach((element, index) => {
      // Skip if already processed as part of radio/checkbox group
      const elementId = element.id || element.name
      if (elementId && processedInputIds.has(elementId)) {
        return
      }
      
      // Skip hidden inputs and buttons
      if (element.type === 'hidden' || element.type === 'submit' || element.type === 'button') {
        return
      }
      
      // Skip file inputs
      if (element.type === 'file') {
        return
      }
      
      // Skip radio and checkbox inputs (already processed)
      if (element.type === 'radio' || element.type === 'checkbox') {
        return
      }
      
      // Skip signature fields (they might have specific classes or structure)
      // Also skip buttons like "Preview"
      const elementText = element.value || element.textContent || ''
      const parentText = element.closest('div')?.textContent || ''
      const placeholder = element.placeholder || ''
      
      // Skip buttons and preview elements
      if (elementText.toLowerCase().includes('preview') || 
          parentText.toLowerCase().includes('preview') ||
          element.closest('button') ||
          element.type === 'button') {
        return
      }
      
      // Skip "Other" option text inputs (they're already part of radio/checkbox groups)
      // These typically have placeholder "Please specify..." and are near radio/checkbox groups
      if (element.type === 'text' && 
          (placeholder.toLowerCase().includes('please specify') ||
           placeholder.toLowerCase().includes('specify'))) {
        // Check if this is near a radio/checkbox with "other" option
        const parentDiv = element.closest('div')
        if (parentDiv) {
          const nearbyRadio = parentDiv.querySelector('input[type="radio"][value="other"]')
          const nearbyCheckbox = parentDiv.querySelector('input[type="checkbox"][value="other"]')
          if (nearbyRadio || nearbyCheckbox) {
            // This is an "Other" option text input, skip it
            return
          }
        }
      }
      
      // Skip signature field placeholders
      if (placeholder.toLowerCase().includes('enter your full name') ||
          placeholder.toLowerCase().includes('sign here') ||
          elementText.toLowerCase().includes('signature')) {
        return
      }
      
      // Skip date fields that are likely buttons (very short labels like "Date")
      if (element.type === 'date') {
        const labelText = element.previousElementSibling?.textContent?.trim() || ''
        if (labelText.toLowerCase() === 'date' && labelText.length < 10) {
          // Likely a button or signature date field, skip
          return
        }
      }
      
      // Find the associated label
      let labelText = ''
      let isRequired = false
      
      // Method 1: Check for explicit label with 'for' attribute
      const labelId = element.id || element.name
      if (labelId) {
        const label = document.querySelector(`label[for="${labelId}"]`)
        if (label && !label.querySelector('input, button')) {
          const extracted = extractLabelText(label)
          labelText = extracted.text
          isRequired = extracted.required
        }
      }
      
      // Method 2: Find parent label element (but not if it contains radio/checkbox)
      if (!labelText) {
        const parentLabel = element.closest('label')
        if (parentLabel && !parentLabel.querySelector('input[type="radio"], input[type="checkbox"]')) {
          const extracted = extractLabelText(parentLabel)
          labelText = extracted.text
          if (!isRequired) isRequired = extracted.required
          if (element.type === 'text' || element.type === 'email' || element.type === 'tel') {
            labelText = labelText.replace(element.value || '', '').trim()
          }
        }
      }
      
      // Method 3: Find preceding label element
      if (!labelText) {
        let prevSibling = element.previousElementSibling
        while (prevSibling) {
          if (prevSibling.tagName === 'LABEL' && !prevSibling.querySelector('input[type="radio"], input[type="checkbox"]')) {
            const extracted = extractLabelText(prevSibling)
            labelText = extracted.text
            if (!isRequired) isRequired = extracted.required
            break
          }
          prevSibling = prevSibling.previousElementSibling
        }
      }
      
      // Method 4: Find parent div's first label child
      if (!labelText) {
        const parentDiv = element.closest('div')
        if (parentDiv) {
          const labelInParent = parentDiv.querySelector('label')
          if (labelInParent && !labelInParent.querySelector('input[type="radio"], input[type="checkbox"]')) {
            const parentChildren = Array.from(parentDiv.children)
            const labelPosition = parentChildren.indexOf(labelInParent)
            const inputPosition = parentChildren.indexOf(element)
            
            if (labelPosition < inputPosition || labelPosition === 0) {
              const extracted = extractLabelText(labelInParent)
              labelText = extracted.text
              if (!isRequired) isRequired = extracted.required
            }
          }
        }
      }
      
      // Method 5: Use placeholder or name as fallback
      if (!labelText) {
        labelText = element.placeholder || element.name || `Field ${index + 1}`
      }
      
      // Final check if required
      if (!isRequired) {
        isRequired = element.hasAttribute('required') || element.getAttribute('aria-required') === 'true'
      }
      
      // Determine field type
      let fieldType = 'text'
      let options = []
      
      if (element.tagName === 'TEXTAREA') {
        fieldType = 'textarea'
      } else if (element.tagName === 'SELECT') {
        fieldType = 'select'
        const optionElements = element.querySelectorAll('option')
        optionElements.forEach(opt => {
          const value = opt.value
          const text = opt.textContent?.trim() || ''
          if (value && value !== '') {
            options.push(text || value)
          }
        })
      } else if (element.type === 'email') {
        fieldType = 'email'
      } else if (element.type === 'tel') {
        fieldType = 'tel'
      } else if (element.type === 'date') {
        fieldType = 'date'
      } else if (element.type === 'number') {
        fieldType = 'text' // Map number to text
      }
      
      // Extract placeholder
      const placeholder = element.placeholder || null
      
      // Create field object
      const field = {
        id: element.id || element.name || `field_${Date.now()}_${index}`,
        label: labelText,
        type: fieldType,
        required: isRequired,
        placeholder: placeholder,
        options: options.length > 0 ? options : undefined
      }
      
      extractedFields.push(field)
    })
    
    // Deduplicate fields by id
    const uniqueFields = []
    const seenIds = new Set()
    
    extractedFields.forEach(field => {
      if (!seenIds.has(field.id)) {
        seenIds.add(field.id)
        uniqueFields.push(field)
      }
    })
    
    return uniqueFields
  })
  
  console.log(`✅ Extracted ${fields.length} fields from DOM`)
  return fields
}

module.exports = {
  extractFormFieldsFromDOM
}
