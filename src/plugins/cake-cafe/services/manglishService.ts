/**
 * Manglish (Malayalam + English) Support Service
 * Normalizes mixed Malayalam-English text to English for AI processing
 */

// Malayalam-English dictionary for common ordering phrases
const manglishToEnglish: Record<string, string> = {
  // Numbers (Malayalam transliteration)
  'oru': 'one',
  'onnu': 'one',
  'randu': 'two',
  'rendu': 'two',
  'moonu': 'three',
  'moonnu': 'three',
  'nalu': 'four',
  'naalu': 'four',
  'anju': 'five',
  'anchu': 'five',
  'aaru': 'six',
  'ezhu': 'seven',
  'ettu': 'eight',
  'onpathu': 'nine',
  'pathu': 'ten',

  // Common ordering words
  'veno': 'do you want',
  'venam': 'want',
  'vേണം': 'want',
  'venamm': 'want',
  'vendatha': 'not needed',
  'venda': 'no need',
  'tharam': 'will give',
  'thaa': 'give',
  'thaaa': 'give',
  'kittumo': 'is it available',
  'undo': 'is there',
  'und': 'is there',
  'illa': 'no',
  'illaa': 'no',
  'aahn': 'yes',
  'aah': 'yes',
  'sheriya': 'correct',
  'sheri': 'okay',
  'seri': 'okay',
  'aayi': 'okay',
  'mathi': 'enough',
  'mathiyaayi': 'that is enough',
  'ketto': 'okay',
  'pakshe': 'but',
  'ennal': 'then',
  'pinne': 'then',
  'ippol': 'now',
  'ippo': 'now',
  'kazhiju': 'finished',
  'kazhinju': 'finished',
  'aayallo': 'done',

  // Time words
  'innu': 'today',
  'innale': 'yesterday',
  'nale': 'tomorrow',
  'naale': 'tomorrow',
  'raavile': 'morning',
  'vaikunneram': 'evening',
  'vaikittu': 'evening',
  'raathri': 'night',

  // Food items (common Malayalam names)
  'chaya': 'tea',
  'chaaya': 'tea',
  'kaapi': 'coffee',
  'kaappi': 'coffee',
  'kattan': 'black tea',
  'vellam': 'water',
  'paal': 'milk',
  'paalu': 'milk',
  'choru': 'rice',
  'chorum': 'rice and',
  'dosa': 'dosa',
  'dosai': 'dosa',
  'idli': 'idli',
  'idly': 'idli',
  'puttu': 'puttu',
  'appam': 'appam',
  'parotta': 'parotta',
  'porotta': 'parotta',

  // Common typos and misspellings
  'burgr': 'burger',
  'burgar': 'burger',
  'buger': 'burger',
  'coffe': 'coffee',
  'cofee': 'coffee',
  'coffie': 'coffee',
  'piza': 'pizza',
  'pizzza': 'pizza',
  'sandwch': 'sandwich',
  'sandwhich': 'sandwich',
  'sanwich': 'sandwich',
  'choclate': 'chocolate',
  'chocklate': 'chocolate',
  'chocolat': 'chocolate',
  'vanila': 'vanilla',
  'vanilla': 'vanilla',
  'strawbery': 'strawberry',
  'strawbry': 'strawberry',
  'appl': 'apple',
  'banan': 'banana',
  'bannana': 'banana',
  'orenge': 'orange',
  'ornge': 'orange',
  'mango': 'mango',
  'mangoo': 'mango',

  // Cake related
  'kayke': 'cake',
  'caek': 'cake',
  'kek': 'cake',
  'birtday': 'birthday',
  'bday': 'birthday',
  'happpy': 'happy',

  // Quantity modifiers
  'koodi': 'more',
  'koode': 'also',
  'kure': 'some',
  'kurach': 'little',
  'kurachude': 'a little more',
};

/**
 * Normalize Manglish text to English
 * Replaces Malayalam-English words with their English equivalents
 */
export function normalizeManglish(message: string): string {
  let normalized = message.toLowerCase();

  // Sort by length (longest first) to avoid partial replacements
  const sortedEntries = Object.entries(manglishToEnglish).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [manglish, english] of sortedEntries) {
    // Word boundary matching to avoid partial word replacements
    const regex = new RegExp(`\\b${manglish}\\b`, 'gi');
    normalized = normalized.replace(regex, english);
  }

  return normalized;
}

/**
 * Check if text contains Malayalam script (Unicode range)
 * Malayalam Unicode block: U+0D00 to U+0D7F
 */
export function containsMalayalamScript(text: string): boolean {
  return /[\u0D00-\u0D7F]/.test(text);
}

/**
 * Detect if message is primarily in Manglish
 * Returns true if message contains common Manglish words
 */
export function isManglishMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  const manglishWords = Object.keys(manglishToEnglish);

  let matchCount = 0;
  for (const word of manglishWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(lowerMessage)) {
      matchCount++;
    }
  }

  // Consider it Manglish if 1+ Manglish words found
  return matchCount >= 1;
}

/**
 * Get the Manglish words that were normalized
 * Useful for logging/debugging
 */
export function getManglishMatches(message: string): string[] {
  const lowerMessage = message.toLowerCase();
  const matches: string[] = [];

  for (const word of Object.keys(manglishToEnglish)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(lowerMessage)) {
      matches.push(word);
    }
  }

  return matches;
}
