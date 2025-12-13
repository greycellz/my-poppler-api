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
    
    // Find all form elements (inputs, textareas, selects)
    // In ChatterForms, fields are rendered in a structure like:
    // <div>
    //   <label>Field Label</label>
    //   <input|textarea|select id="field_id" name="field_id" ... />
    // </div>
    
    // Strategy 1: Find all input, textarea, select elements
    const formElements = document.querySelectorAll('input, textarea, select')
    
    formElements.forEach((element, index) => {
      // Skip hidden inputs and submit buttons
      if (element.type === 'hidden' || element.type === 'submit' || element.type === 'button') {
        return
      }
      
      // Skip file inputs (handled separately)
      if (element.type === 'file') {
        return
      }
      
      // Find the associated label
      let labelText = ''
      let isRequired = false
      
      // Helper function to extract label text and check for required indicator
      const extractLabelText = (labelElement) => {
        if (!labelElement) return { text: '', required: false }
        
        // Clone to avoid modifying original
        const labelClone = labelElement.cloneNode(true)
        
        // Check for required indicator (asterisk or required span)
        const hasAsterisk = labelClone.textContent?.includes('*')
        const requiredSpan = labelClone.querySelector('span[style*="color: #ef4444"], span[style*="color:#ef4444"]')
        const isFieldRequired = hasAsterisk || !!requiredSpan || element.hasAttribute('required')
        
        // Remove required indicators from text
        labelClone.querySelectorAll('span[style*="color: #ef4444"], span[style*="color:#ef4444"]').forEach(el => el.remove())
        
        // Get clean label text
        let text = labelClone.textContent?.trim() || ''
        text = text.replace(/\s*\*+\s*$/, '').trim() // Remove trailing asterisks
        
        return { text, required: isFieldRequired }
      }
      
      // Method 1: Check for explicit label with 'for' attribute
      const labelId = element.id || element.name
      if (labelId) {
        const label = document.querySelector(`label[for="${labelId}"]`)
        if (label) {
          const extracted = extractLabelText(label)
          labelText = extracted.text
          isRequired = extracted.required
        }
      }
      
      // Method 2: Find parent label element
      if (!labelText) {
        const parentLabel = element.closest('label')
        if (parentLabel) {
          const extracted = extractLabelText(parentLabel)
          labelText = extracted.text
          if (!isRequired) isRequired = extracted.required
          // Remove the input element's value from label text if it appears
          if (element.type === 'text' || element.type === 'email' || element.type === 'tel') {
            labelText = labelText.replace(element.value || '', '').trim()
          }
        }
      }
      
      // Method 3: Find preceding label element (ChatterForms pattern)
      if (!labelText) {
        // Look for a label element that comes before this input in the DOM
        let prevSibling = element.previousElementSibling
        while (prevSibling) {
          if (prevSibling.tagName === 'LABEL') {
            const extracted = extractLabelText(prevSibling)
            labelText = extracted.text
            if (!isRequired) isRequired = extracted.required
            break
          }
          prevSibling = prevSibling.previousElementSibling
        }
      }
      
      // Method 4: Find parent div's first label child (ChatterForms structure)
      // In ChatterForms, structure is: <div><label>Label</label><input/></div>
      if (!labelText) {
        const parentDiv = element.closest('div')
        if (parentDiv) {
          // Find label that is a direct child or sibling of the input
          const labelInParent = parentDiv.querySelector('label')
          if (labelInParent) {
            // Check if label comes before this element in DOM order
            const parentChildren = Array.from(parentDiv.children)
            const labelPosition = parentChildren.indexOf(labelInParent)
            const inputPosition = parentChildren.indexOf(element)
            
            // Only use label if it comes before the input or is the first child
            if (labelPosition < inputPosition || labelPosition === 0) {
              const extracted = extractLabelText(labelInParent)
              labelText = extracted.text
              if (!isRequired) isRequired = extracted.required
            }
          }
        }
      }
      
      // Method 5: Look for label in parent container (broader search)
      if (!labelText) {
        let current = element.parentElement
        let depth = 0
        while (current && depth < 3) {
          const label = current.querySelector('label')
          if (label && label !== element) {
            const extracted = extractLabelText(label)
            labelText = extracted.text
            if (!isRequired) isRequired = extracted.required
            if (labelText) break
          }
          current = current.parentElement
          depth++
        }
      }
      
      // Method 6: Use placeholder or name as fallback
      if (!labelText) {
        labelText = element.placeholder || element.name || `Field ${index + 1}`
      }
      
      // Final check if required (if not already determined from label)
      if (!isRequired) {
        isRequired = element.hasAttribute('required') || element.getAttribute('aria-required') === 'true'
      }
      
      // Determine field type
      let fieldType = 'text'
      let options = []
      let allowOther = false
      let otherLabel = null
      let otherPlaceholder = null
      
      if (element.tagName === 'TEXTAREA') {
        fieldType = 'textarea'
      } else if (element.tagName === 'SELECT') {
        fieldType = 'select'
        // Extract options
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
        // Map number to text for now (FieldExtraction type doesn't include 'number')
        fieldType = 'text'
      } else if (element.type === 'radio') {
        // Radio buttons - need to find all radios with same name
        const radioName = element.name
        if (radioName) {
          const allRadios = document.querySelectorAll(`input[type="radio"][name="${radioName}"]`)
          const radioOptions = []
          let hasOther = false
          
          allRadios.forEach(radio => {
            const radioValue = radio.value
            const radioLabel = radio.closest('label')
            let radioText = radioValue
            
            if (radioLabel) {
              // Get text from label, excluding the radio button itself
              const labelClone = radioLabel.cloneNode(true)
              const radioInClone = labelClone.querySelector('input[type="radio"]')
              if (radioInClone) {
                radioInClone.remove()
              }
              radioText = labelClone.textContent?.trim() || radioValue
            }
            
            // Check if this is an "other" option (be more specific to avoid "Mother", "Brother", etc.)
            const normalizedRadioText = radioText.toLowerCase().trim()
            const isOtherOption = radioValue === 'other' || 
              normalizedRadioText === 'other' ||
              normalizedRadioText === 'other:' ||
              (normalizedRadioText.startsWith('other') && normalizedRadioText.length < 20 && 
               !normalizedRadioText.includes('mother') && !normalizedRadioText.includes('brother') &&
               !normalizedRadioText.includes('father') && !normalizedRadioText.includes('another'))
            
            if (isOtherOption) {
              hasOther = true
              otherLabel = radioText
              // Look for associated text input
              const otherInput = radio.closest('div')?.querySelector('input[type="text"]')
              if (otherInput) {
                otherPlaceholder = otherInput.placeholder || 'Please specify...'
              }
            } else {
              radioOptions.push(radioText)
            }
          })
          
          // Only add if we haven't already processed this radio group
          const existingRadioField = extractedFields.find(f => 
            f.type === 'radio-with-other' && f.id === radioName
          )
          
          if (!existingRadioField && radioOptions.length > 0) {
            fieldType = hasOther ? 'radio-with-other' : 'radio'
            options = radioOptions
            allowOther = hasOther
          } else {
            // Skip - already processed
            return
          }
        }
      } else if (element.type === 'checkbox') {
        // Checkboxes - need to find all checkboxes with same name
        const checkboxName = element.name
        if (checkboxName) {
          const allCheckboxes = document.querySelectorAll(`input[type="checkbox"][name="${checkboxName}"]`)
          const checkboxOptions = []
          let hasOther = false
          
          allCheckboxes.forEach(checkbox => {
            const checkboxValue = checkbox.value
            const checkboxLabel = checkbox.closest('label')
            let checkboxText = checkboxValue
            
            if (checkboxLabel) {
              const labelClone = checkboxLabel.cloneNode(true)
              const checkboxInClone = labelClone.querySelector('input[type="checkbox"]')
              if (checkboxInClone) {
                checkboxInClone.remove()
              }
              checkboxText = labelClone.textContent?.trim() || checkboxValue
            }
            
            // Check if this is an "other" option (be more specific to avoid "Mother", "Brother", etc.)
            const normalizedCheckboxText = checkboxText.toLowerCase().trim()
            const isOtherOption = checkboxValue === 'other' || 
              normalizedCheckboxText === 'other' ||
              normalizedCheckboxText === 'other:' ||
              (normalizedCheckboxText.startsWith('other') && normalizedCheckboxText.length < 20 && 
               !normalizedCheckboxText.includes('mother') && !normalizedCheckboxText.includes('brother') &&
               !normalizedCheckboxText.includes('father') && !normalizedCheckboxText.includes('another'))
            
            if (isOtherOption) {
              hasOther = true
              otherLabel = checkboxText
              const otherInput = checkbox.closest('div')?.querySelector('input[type="text"]')
              if (otherInput) {
                otherPlaceholder = otherInput.placeholder || 'Please specify...'
              }
            } else {
              checkboxOptions.push(checkboxText)
            }
          })
          
          const existingCheckboxField = extractedFields.find(f => 
            f.type === 'checkbox-with-other' && f.id === checkboxName
          )
          
          if (!existingCheckboxField && checkboxOptions.length > 0) {
            fieldType = hasOther ? 'checkbox-with-other' : 'checkbox'
            options = checkboxOptions
            allowOther = hasOther
          } else {
            return
          }
        }
      }
      
      // Note: Radio/checkbox deduplication is already handled above in their respective blocks
      // This check is redundant but kept for safety - only skip if we're processing a duplicate
      // that wasn't caught by the earlier logic
      if ((fieldType === 'radio' || fieldType === 'radio-with-other' || 
           fieldType === 'checkbox' || fieldType === 'checkbox-with-other')) {
        const fieldId = element.id || element.name
        if (fieldId && extractedFields.some(f => f.id === fieldId && f.type === fieldType)) {
          // Already processed this radio/checkbox group
          return
        }
      }
      
      // Extract placeholder
      const placeholder = element.placeholder || null
      
      // Create field object
      const field = {
        id: element.id || element.name || `field_${index}`,
        label: labelText,
        type: fieldType,
        required: isRequired,
        placeholder: placeholder,
        options: options.length > 0 ? options : undefined,
        allowOther: allowOther || undefined,
        otherLabel: otherLabel || undefined,
        otherPlaceholder: otherPlaceholder || undefined
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
