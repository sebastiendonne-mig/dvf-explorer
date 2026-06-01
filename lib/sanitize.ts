/**
 * Sanitize and validate French addresses
 * - Strip HTML/scripts
 * - Check length (5-200 chars)
 * - Regex alphanumérique + ponctuation française
 * - Extract department code from INSEE code
 */

export function sanitizeAddress(input: string): string {
  // Strip HTML tags
  let clean = input.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  clean = clean
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Trim whitespace
  clean = clean.trim();
  
  // Check length
  if (clean.length < 5) {
    throw new Error('Adresse trop courte (minimum 5 caractères)');
  }
  if (clean.length > 200) {
    throw new Error('Adresse trop longue (maximum 200 caractères)');
  }
  
  // Check for authorized characters only (French alphanumeric + punctuation)
  // Allow: letters (FR accents), numbers, spaces, commas, hyphens, periods, apostrophes
  const regex = /^[a-zA-Z0-9\u00C0-\u017F\s,'\-\.]+$/;
  if (!regex.test(clean)) {
    throw new Error('Caractères non autorisés dans l\'adresse');
  }
  
  return clean;
}

/**
 * Extract department code from INSEE code
 * INSEE format: CCCPP (commune 3 chars + postal 2 chars)
 * We extract the first 2 chars as department
 */
export function extractDepartmentFromInsee(insee: string): string {
  if (!insee || insee.length < 2) return '';
  return insee.substring(0, 2);
}

/**
 * Check if department is excluded (Alsace-Moselle or Mayotte)
 */
export function isDepartmentExcluded(departmentCode: string): boolean {
  const excludedDepts = ['57', '67', '68', '976'];
  return excludedDepts.includes(departmentCode);
}

/**
 * Format a date from YYYY-MM-DD format
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];
  
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
}

/**
 * Format price with thousands separator
 */
export function formatPrice(price: number): string {
  return price.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}
