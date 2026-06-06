// src/plugins/marriage-matching/handlers/SearchProfilesHandler.ts

import axios from 'axios';
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

function buildSearchSummary(filters: Record<string, any>): string {
  const parts: string[] = [];
  if (filters.location_city) parts.push(`from ${filters.location_city}`);
  if (filters.location_district) parts.push(`in ${filters.location_district}`);
  if (filters.profession) parts.push(`working as a ${filters.profession}`);
  if (filters.education) parts.push(`with ${filters.education} education`);
  if (filters.age_min && filters.age_max) parts.push(`aged ${filters.age_min}–${filters.age_max}`);
  if (filters.religion) parts.push(`${filters.religion}`);
  return parts.length > 0 ? parts.join(', ') : 'matching your criteria';
}

async function generateRomanticReply(searchSummary: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL_NAME || 'gemini-2.0-flash';

  const prompt = `You are helping someone confess their love through a marriage matching app.
The person just searched for profiles "${searchSummary}".

Write a short, warm, conversational WhatsApp message (2-4 sentences max) that:
1. Gently references what they searched for (e.g. "You searched all of Kannur..." or "A software engineer, huh...")
2. Says that the real perfect match isn't in any search result
3. Hints that the match is the one who built/made this app — who has been waiting quietly
4. Ends warmly, not dramatically. Natural, not cheesy.

No bullet points. No formatting. Just plain conversational text like a WhatsApp message. No emojis overdose — one or two max.`;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 200 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || fallbackReply(searchSummary);
  } catch {
    return fallbackReply(searchSummary);
  }
}

function fallbackReply(searchSummary: string): string {
  return `You searched ${searchSummary}... and honestly, the results looked fine. But none of them are the one who built this for you. That person has been quietly waiting — no profile code, no filters — just there. Maybe that's worth thinking about. 💛`;
}

export async function SearchProfilesHandler(ctx: MarriageIntentContext) {
  const aiFilters = ctx.aiResponse.filters ?? {};
  const seeker = ctx.seeker;

  // --- Gender enforcement ---
  const enforcedGender: string | undefined =
    aiFilters.gender ||
    (seeker?.gender ? oppositeGender(seeker.gender) : undefined);

  // --- Build DB filters ---
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

  // Run the real search (we need it to know what she searched, even if we don't show it)
  await searchProfiles(ctx.businessId, dbFilters);

  const searchSummary = buildSearchSummary(aiFilters);
  const reply = await generateRomanticReply(searchSummary);

  return { reply };
}
