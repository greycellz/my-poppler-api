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
    const processedSignatureFields = new Set()
    
    // Helper function to find main question label for a field group
    const findMainQuestionLabel = (element) => {
      let current = element.parentElement
      let depth = 0
      const maxDepth = 5
      
      while (current && depth < maxDepth) {
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
    
    // First pass: Detect rating fields (they're buttons, not form inputs)
    // We need to detect them separately since they don't have input/textarea/select elements
    const allButtons = document.querySelectorAll('button[type="button"]')
    const processedRatingContainers = new Set()
    
    allButtons.forEach(button => {
      // Check if this button is part of a rating field
      const parentContainer = button.closest('div')
      if (!parentContainer || processedRatingContainers.has(parentContainer)) {
        return
      }
      
      // Check if this container has rating-like structure
      const buttons = parentContainer.querySelectorAll('button[type="button"]')
      if (buttons.length < 3 || buttons.length > 10) {
        return
      }
      
      const buttonText = Array.from(buttons).map(btn => btn.textContent || '').join('')
      const hasStarSymbols = buttonText.includes('★') || buttonText.includes('☆')
      const hasEmojiButtons = /[😞😕😐🙂😄]/.test(buttonText)
      const hasStarAriaLabels = Array.from(buttons).some(btn => 
        btn.getAttribute('aria-label')?.toLowerCase().includes('star')
      )
      
      if (hasStarSymbols || hasEmojiButtons || hasStarAriaLabels) {
        processedRatingContainers.add(parentContainer)
        
        // Find the label for the rating field
        let ratingLabel = 'Rating'
        let isRequired = false
        
        // Look for label before the rating component
        let current = parentContainer.parentElement
        let depth = 0
        while (current && depth < 3) {
          const label = current.querySelector('label')
          if (label && !label.querySelector('input, button, canvas')) {
            const extracted = extractLabelText(label)
            if (extracted.text && extracted.text.toLowerCase() !== 'rating') {
              ratingLabel = extracted.text
              isRequired = extracted.required
              break
            }
          }
          current = current.parentElement
          depth++
        }
        
        // Mark all buttons in this rating component as processed
        buttons.forEach(btn => {
          if (btn.id) processedInputIds.add(btn.id)
        })
        
        // Add rating field (we'll insert it in the right position later)
        // For now, add it to a separate array and we'll merge based on DOM position
        extractedFields.push({
          id: `rating_${Date.now()}_${extractedFields.length}`,
          label: ratingLabel,
          type: 'rating',
          required: isRequired,
          placeholder: null,
          options: undefined,
          _domPosition: parentContainer.compareDocumentPosition ? 
            Array.from(document.querySelectorAll('input, textarea, select, button')).indexOf(buttons[0]) : 
            -1
        })
      }
    })
    
    // Process ALL form elements in DOM order to preserve sequence
    const allFormElements = document.querySelectorAll('input, textarea, select')
    
    allFormElements.forEach((element, index) => {
      // Skip hidden inputs and submit buttons
      if (element.type === 'hidden' || element.type === 'submit' || element.type === 'button') {
        return
      }
      
      // Process file inputs (they're standard HTML, just hidden in ModernFileUpload)
      if (element.type === 'file') {
        // Find the label for the file upload field
        let labelText = 'File upload'
        let isRequired = false
        
        // Look for label in parent container (ModernFileUpload structure)
        const parentContainer = element.closest('div')
        if (parentContainer) {
          // ModernFileUpload has a label before the drag-drop area
          const label = parentContainer.querySelector('label')
          if (label && !label.querySelector('input')) {
            const extracted = extractLabelText(label)
            labelText = extracted.text || 'File upload'
            isRequired = extracted.required
          }
          
          // Also check for label in parent of parent (if ModernFileUpload is nested)
          const grandParent = parentContainer.parentElement
          if (grandParent) {
            const parentLabel = grandParent.querySelector('label')
            if (parentLabel && !parentLabel.querySelector('input, canvas, button')) {
              const extracted = extractLabelText(parentLabel)
              if (extracted.text && extracted.text.toLowerCase() !== 'file upload') {
                labelText = extracted.text
                isRequired = extracted.required
              }
            }
          }
        }
        
        // Check if required
        if (!isRequired) {
          isRequired = element.hasAttribute('required')
        }
        
        // Only add if we haven't already added this file field
        const elementId = element.id || element.name
        if (elementId && processedInputIds.has(elementId)) {
          return
        }
        if (elementId) processedInputIds.add(elementId)
        
        extractedFields.push({
          id: elementId || `file_${Date.now()}`,
          label: labelText,
          type: 'file',
          required: isRequired,
          placeholder: null,
          options: undefined
        })
        
        return // Skip further processing
      }
      
      // Check if this element is part of a signature field
      const signatureContainer = element.closest('.signature-capture') || 
                                 element.closest('div[class*="signature"]')
      
      if (signatureContainer) {
        // Find the main label for the signature field (should be outside signature-capture)
        let signatureLabel = 'Signature'
        let signatureId = null
        let isRequired = false
        
        // Look for label before the signature container
        let current = signatureContainer.parentElement
        let depth = 0
        while (current && depth < 3) {
          const label = current.querySelector('label')
          if (label && !label.querySelector('input, canvas, button')) {
            const extracted = extractLabelText(label)
            if (extracted.text && extracted.text.toLowerCase() !== 'preview') {
              signatureLabel = extracted.text
              isRequired = extracted.required
              break
            }
          }
          current = current.parentElement
          depth++
        }
        
        // Use the first input's id/name as the signature field id
        signatureId = element.id || element.name || `signature_${Date.now()}`
        
        // Only add signature field once per container
        if (!processedSignatureFields.has(signatureContainer)) {
          processedSignatureFields.add(signatureContainer)
          // Mark all inputs in this signature container as processed
          signatureContainer.querySelectorAll('input, canvas, button').forEach(el => {
            if (el.id) processedInputIds.add(el.id)
            if (el.name) processedInputIds.add(el.name)
          })
          
          extractedFields.push({
            id: signatureId,
            label: signatureLabel,
            type: 'signature',
            required: isRequired,
            placeholder: null,
            options: undefined
          })
        }
        
        // Skip processing this element further (it's part of signature field)
        return
      }
      
      // Skip if already processed as part of a group
      const elementId = element.id || element.name
      if (elementId && processedInputIds.has(elementId)) {
        return
      }
      
      // Process radio buttons
      if (element.type === 'radio') {
        const radioName = element.name
        if (!radioName || processedRadioGroups.has(radioName)) {
          return
        }
        
        processedRadioGroups.add(radioName)
        const allRadiosInGroup = document.querySelectorAll(`input[type="radio"][name="${radioName}"]`)
        if (allRadiosInGroup.length === 0) return
        
        // Find main question label
        let mainLabel = findMainQuestionLabel(element)
        if (!mainLabel) {
          const labelId = element.id || radioName
          const label = document.querySelector(`label[for="${labelId}"]`)
          if (label && !label.querySelector('input[type="radio"]')) {
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
        const radioOptions = []
        let hasOther = false
        let otherLabel = null
        let otherPlaceholder = null
        let isRequired = false
        
        allRadiosInGroup.forEach(radioInput => {
          const radioId = radioInput.id || radioInput.name
          if (radioId) processedInputIds.add(radioId)
          
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
          
          if (radioInput.hasAttribute('required')) {
            isRequired = true
          }
          
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
              const otherId = otherInput.id || otherInput.name
              if (otherId) processedInputIds.add(otherId)
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
        
        return // Skip individual radio processing
      }
      
      // Process checkboxes
      if (element.type === 'checkbox') {
        const checkboxName = element.name
        if (!checkboxName || processedCheckboxGroups.has(checkboxName)) {
          return
        }
        
        processedCheckboxGroups.add(checkboxName)
        const allCheckboxesInGroup = document.querySelectorAll(`input[type="checkbox"][name="${checkboxName}"]`)
        if (allCheckboxesInGroup.length === 0) return
        
        // Find main question label
        let mainLabel = findMainQuestionLabel(element)
        if (!mainLabel) {
          const labelId = element.id || checkboxName
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
          const checkboxId = checkboxInput.id || checkboxInput.name
          if (checkboxId) processedInputIds.add(checkboxId)
          
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
              const otherId = otherInput.id || otherInput.name
              if (otherId) processedInputIds.add(otherId)
            }
          } else {
            checkboxOptions.push(checkboxText)
          }
        })
        
        // Only add one checkbox field per group
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
        
        return // Skip individual checkbox processing
      }
      
      // Skip if this element is inside a rating field container we already processed
      const parentContainer = element.closest('div')
      if (parentContainer && processedRatingContainers.has(parentContainer)) {
        return
      }
      
      // Process other form elements (text, email, tel, textarea, select, date)
      const elementText = element.value || element.textContent || ''
      const parentText = element.closest('div')?.textContent || ''
      
      // Skip buttons and preview elements
      if (elementText.toLowerCase().includes('preview') || 
          parentText.toLowerCase().includes('preview') ||
          element.closest('button') ||
          element.type === 'button') {
        return
      }
      
      // Skip "Other" option text inputs using DOM structure
      if (element.type === 'text') {
        const parentContainer = element.closest('div')
        if (parentContainer) {
          const radiosInContainer = parentContainer.querySelectorAll('input[type="radio"]')
          const checkboxesInContainer = parentContainer.querySelectorAll('input[type="checkbox"]')
          
          const hasOtherOption = Array.from(radiosInContainer).some(radio => {
            const radioValue = radio.value?.toLowerCase() || ''
            const radioLabel = radio.closest('label')
            const labelText = radioLabel ? radioLabel.textContent?.toLowerCase().trim() : ''
            return radioValue === 'other' || 
                   labelText === 'other' || 
                   labelText === 'other:' ||
                   (labelText.startsWith('other') && labelText.length < 20)
          }) || Array.from(checkboxesInContainer).some(checkbox => {
            const checkboxValue = checkbox.value?.toLowerCase() || ''
            const checkboxLabel = checkbox.closest('label')
            const labelText = checkboxLabel ? checkboxLabel.textContent?.toLowerCase().trim() : ''
            return checkboxValue === 'other' || 
                   labelText === 'other' || 
                   labelText === 'other:' ||
                   (labelText.startsWith('other') && labelText.length < 20)
          })
          
          if (hasOtherOption) {
            const allInputs = parentContainer.querySelectorAll('input')
            const elementIndex = Array.from(allInputs).indexOf(element)
            const otherRadioIndex = Array.from(allInputs).findIndex(input => {
              if (input.type === 'radio' || input.type === 'checkbox') {
                const value = input.value?.toLowerCase() || ''
                const label = input.closest('label')
                const labelText = label ? label.textContent?.toLowerCase().trim() : ''
                return value === 'other' || 
                       labelText === 'other' || 
                       labelText === 'other:' ||
                       (labelText.startsWith('other') && labelText.length < 20)
              }
              return false
            })
            
            if (otherRadioIndex >= 0 && elementIndex > otherRadioIndex) {
              return // Skip this "Other" text input
            }
          }
        }
      }
      
      // Extract placeholder early (used for multiple checks)
      const elementPlaceholder = element.placeholder || ''
      
      // Find the associated label
      let labelText = ''
      let isRequired = false
      
      // Method 1: Check for explicit label with 'for' attribute
      const labelId = element.id || element.name
      if (labelId) {
        const label = document.querySelector(`label[for="${labelId}"]`)
        if (label && !label.querySelector('input, button, canvas')) {
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
          if (labelInParent && !labelInParent.querySelector('input[type="radio"], input[type="checkbox"], canvas, button')) {
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
        labelText = elementPlaceholder || element.name || `Field ${index + 1}`
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
      
      // Create field object
      const field = {
        id: element.id || element.name || `field_${Date.now()}_${index}`,
        label: labelText,
        type: fieldType,
        required: isRequired,
        placeholder: elementPlaceholder || null,
        options: options.length > 0 ? options : undefined
      }
      
      extractedFields.push(field)
    })
    
    // Sort fields by DOM position to preserve order
    // Fields with _domPosition are rating fields, sort them appropriately
    const fieldsWithPosition = extractedFields.map((field, index) => {
      if (field._domPosition !== undefined) {
        return { field, position: field._domPosition }
      }
      // For regular fields, use their index in the form elements array
      // This is approximate but should work for most cases
      return { field, position: index * 1000 }
    })
    
    // Sort by position, then remove _domPosition
    fieldsWithPosition.sort((a, b) => {
      if (a.position < 0) return 1 // Rating fields without position go to end
      if (b.position < 0) return -1
      return a.position - b.position
    })
    
    // Deduplicate fields by id and remove _domPosition
    const uniqueFields = []
    const seenIds = new Set()
    
    fieldsWithPosition.forEach(({ field }) => {
      if (!seenIds.has(field.id)) {
        seenIds.add(field.id)
        // Remove _domPosition before returning
        const { _domPosition, ...cleanField } = field
        uniqueFields.push(cleanField)
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
