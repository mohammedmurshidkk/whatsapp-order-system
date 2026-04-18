// src/plugins/marriage-matching/handlers/SearchProfilesHandler.ts

import { MarriageIntentContext } from './types';
import { searchProfiles } from '../services/profileService';
import { Profile, Seeker } from '../types';

/**
 * Score a profile against a registered seeker.
 * Higher = more compatible. Max possible = 12.
 */
function scoreProfile(profile: Profile, seeker: Seeker): number {
  let score = 0;

  if (seeker.religion && profile.religion) {
    if (profile.religion.toLowerCase() === seeker.religion.toLowerCase()) score += 3;
  }
  if (seeker.religion_sect && profile.religion_sect) {
    if (profile.religion_sect.toLowerCase() === seeker.religion_sect.toLowerCase()) score += 2;
  }
  if (seeker.location_city && profile.location_city) {
    if (profile.location_city.toLowerCase() === seeker.location_city.toLowerCase()) score += 3;
  }
  // Check if seeker's age falls within what this profile prefers
  if (seeker.age && profile.preferred_age_min && profile.preferred_age_max) {
    if (seeker.age >= profile.preferred_age_min && seeker.age <= profile.preferred_age_max) score += 2;
  }
  // Education rough match bonus
  if (seeker.education && profile.education) {
    if (
      profile.education.toLowerCase().includes(seeker.education.toLowerCase()) ||
      seeker.education.toLowerCase().includes(profile.education.toLowerCase())
    ) score += 1;
  }

  return score;
}

/**
 * Derive the target gender from seeker's own gender.
 * Male seeker → look for female profiles, and vice versa.
 */
function oppositeGender(gender?: string): string | undefined {
  if (gender === 'male') return 'female';
  if (gender === 'female') return 'male';
  return undefined;
}

export async function SearchProfilesHandler(ctx: MarriageIntentContext) {
  const aiFilters = ctx.aiResponse.filters ?? {};
  const seeker = ctx.seeker;

  // --- Gender enforcement ---
  // 1. If AI extracted a gender from the message, use it (explicit request)
  // 2. Else if seeker is registered with a gender, use their opposite
  // 3. Else no gender filter (show all)
  const enforcedGender: string | undefined =
    aiFilters.gender ||
    (seeker?.gender ? oppositeGender(seeker.gender) : undefined);

  // --- Build DB filters ---
  // Fall back to seeker's own religion when AI didn't extract it,
  // but only on vague queries (no location/age filters were given either)
  const isVagueQuery = !aiFilters.religion && !aiFilters.location_city && !aiFilters.age_min && !aiFilters.age_max;
  const dbFilters = {
    gender: enforcedGender,
    religion: aiFilters.religion || (isVagueQuery && seeker?.religion ? seeker.religion : undefined),
    religion_sect: aiFilters.religion_sect || undefined,
    location_city: aiFilters.location_city || undefined,
    location_district: aiFilters.location_district || undefined,
    age_min: aiFilters.age_min,
    age_max: aiFilters.age_max,
    profession: aiFilters.profession || undefined,
    education: aiFilters.education || undefined,
  };

  let profiles = await searchProfiles(ctx.businessId, dbFilters);

  // --- If AI returned specific codes, filter to those only ---
  if (ctx.aiResponse.profile_codes?.length) {
    const codes = new Set(ctx.aiResponse.profile_codes);
    profiles = profiles.filter(p => codes.has(p.profile_code));
  }

  if (profiles.length === 0) {
    return {
      reply: "Sorry, no profiles matched your search. Try broadening your criteria — for example, a wider age range, different location, or removing the sect filter.",
    };
  }

  // --- Compatibility scoring (only when seeker is registered) ---
  let ranked = profiles;
  if (seeker) {
    ranked = [...profiles].sort((a, b) => scoreProfile(b, seeker) - scoreProfile(a, seeker));
  }

  const top5 = ranked.slice(0, 5);

  const list = top5
    .map(p => {
      const parts = [
        `*${p.profile_code}* — ${p.gender === 'male' ? 'Male' : 'Female'}, ${p.age ?? '?'}`,
        p.location_city ? `${p.location_city}` : null,
        p.religion ? `${p.religion}${p.religion_sect ? ` (${p.religion_sect})` : ''}` : null,
        p.profession ?? null,
        p.education ?? null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');

  const remaining = profiles.length > 5
    ? `\n\n_+${profiles.length - 5} more. Narrow your search to see fewer results._`
    : '';

  const reply = `Found *${profiles.length}* matching profile${profiles.length > 1 ? 's' : ''}:\n\n${list}${remaining}\n\nType a profile code (e.g. _${top5[0].profile_code}_) to see full details.`;

  return { reply };
}
