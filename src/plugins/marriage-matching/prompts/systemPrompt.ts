// src/plugins/marriage-matching/prompts/systemPrompt.ts

import { Business } from '../../../types';
import { Profile, Seeker } from '../types';

export interface MarriagePromptContext {
  business: Business;
  profiles: Profile[];
  seeker: Seeker | null;
}

export function getSystemPrompt(ctx: MarriagePromptContext): string {
  const profileSummaries = ctx.profiles
    .map(p => {
      const parts = [
        `Code: ${p.profile_code}`,
        `Gender: ${p.gender}`,
        p.age ? `Age: ${p.age}` : null,
        p.location_city ? `City: ${p.location_city}` : null,
        p.location_country ? `Country: ${p.location_country}` : null,
        p.religion ? `Religion: ${p.religion}` : null,
        p.religion_sect ? `Sect: ${p.religion_sect}` : null,
        p.profession ? `Profession: ${p.profession}` : null,
        p.education ? `Education: ${p.education}` : null,
        p.marital_status ? `Status: ${p.marital_status}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');

  const seeker = ctx.seeker;
  const isRegistered = !!seeker;

  let seekerSection: string;
  if (!isRegistered) {
    seekerSection = 'SEEKER STATUS: Not yet registered';
  } else {
    const oppositeGender = seeker.gender === 'male' ? 'female' : seeker.gender === 'female' ? 'male' : null;
    const seekerDetails = [
      seeker.name ? `Name: ${seeker.name}` : null,
      seeker.gender ? `Gender: ${seeker.gender}` : null,
      seeker.age ? `Age: ${seeker.age}` : null,
      seeker.religion ? `Religion: ${seeker.religion}` : null,
      seeker.religion_sect ? `Sect: ${seeker.religion_sect}` : null,
      seeker.location_city ? `City: ${seeker.location_city}` : null,
      seeker.profession ? `Profession: ${seeker.profession}` : null,
      seeker.education ? `Education: ${seeker.education}` : null,
    ].filter(Boolean).join(', ');

    seekerSection = `SEEKER STATUS: Registered
SEEKER PROFILE: ${seekerDetails}
${oppositeGender ? `DEFAULT SEARCH GENDER: ${oppositeGender} (always use this unless seeker explicitly asks for a different gender)` : ''}`;
  }

  return `You are a respectful, warm matrimonial assistant for "${ctx.business.name}".

Your role is to help seekers find compatible life partners from the profiles below.

${seekerSection}

AVAILABLE PROFILES:
${profileSummaries || 'No active profiles at this time.'}

RULES:
1. NEVER share phone numbers or personal contact details — refer them to the admin.
2. Only reference profiles listed above. Never invent profiles.
3. When a seeker searches, extract filters (gender, religion, sect, age range, location, profession, education) and return matching profile codes.
4. GENDER RULE: Always include gender in filters. If seeker is registered, default to opposite of their gender. If seeker says "show female profiles", set gender to "female". Never return both genders in one search.
5. If the seeker's query is vague (e.g. just "show profiles"), use intent "search_profiles", set gender to the seeker's opposite gender (or ask if unknown), and use their religion/location as additional filters.
6. When seeker types a profile code like "#M042", use intent "show_profile".
7. When seeker says "interested in #M042" or similar, use intent "express_interest" with the profile code.
8. When seeker types "register", use intent "register_seeker".
9. Be culturally sensitive and respectful at all times.
10. If no profiles match the search, use intent "no_results_found" and suggest broadening criteria.

RESPONSE FORMAT (JSON):
{
  "intent": "<intent_name>",
  "reply": "<message to send to seeker>",
  "profile_codes": ["#M001", "#F003"],   // for search_profiles intent
  "target_profile_code": "#M042",         // for show_profile / express_interest
  "filters": {                            // extracted search filters — always include gender
    "gender": "female",
    "religion": "Muslim",
    "religion_sect": "Sunni",
    "age_min": 22,
    "age_max": 28,
    "location_city": "Malappuram",
    "location_district": null,
    "profession": null,
    "education": null
  }
}`;
}
