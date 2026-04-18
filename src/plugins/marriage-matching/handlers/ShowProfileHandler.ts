// src/plugins/marriage-matching/handlers/ShowProfileHandler.ts

import { MarriageIntentContext } from './types';
import { getProfileByCode } from '../services/profileService';
import { Profile } from '../types';

function formatProfile(p: Profile): string {
  const lines: string[] = [
    `*Profile ${p.profile_code}*`,
    `Gender: ${p.gender === 'male' ? 'Male' : 'Female'} | Age: ${p.age ?? '—'}`,
    p.height ? `Height: ${p.height}${p.weight ? ` | Weight: ${p.weight}` : ''}` : '',
    p.skin_tone ? `Skin tone: ${p.skin_tone}` : '',
    p.religion ? `Religion: ${p.religion}${p.religion_sect ? ` (${p.religion_sect})` : ''}` : '',
    p.location_city ? `Location: ${p.location_city}${p.location_country ? `, ${p.location_country}` : ''}` : '',
    p.profession ? `Profession: ${p.profession}` : '',
    p.education ? `Education: ${p.education}` : '',
    p.marital_status ? `Status: ${p.marital_status.replace('_', ' ')}` : '',
    p.languages?.length ? `Languages: ${p.languages.join(', ')}` : '',
    p.description ? `\n_${p.description}_` : '',
  ].filter(Boolean);

  const prefs: string[] = [];
  if (p.preferred_age_min || p.preferred_age_max) {
    prefs.push(`Age: ${p.preferred_age_min ?? '?'}–${p.preferred_age_max ?? '?'}`);
  }
  if (p.preferred_religion) prefs.push(`Religion: ${p.preferred_religion}${p.preferred_sect ? ` (${p.preferred_sect})` : ''}`);
  if (p.preferred_location) prefs.push(`Location: ${p.preferred_location}`);
  if (p.distance_restriction) prefs.push(`Distance: ${p.distance_restriction}`);
  if (p.other_demands) prefs.push(p.other_demands);

  if (prefs.length) lines.push(`\n*Looking for:* ${prefs.join(' | ')}`);

  return lines.join('\n');
}

export async function ShowProfileHandler(ctx: MarriageIntentContext) {
  const code = ctx.aiResponse.target_profile_code
    ?? ctx.message.match(/#[MF]\d+/i)?.[0];

  if (!code) {
    return { reply: "Please provide a profile code, e.g. _#M042_" };
  }

  const profile = await getProfileByCode(ctx.businessId, code.toUpperCase());

  if (!profile) {
    return { reply: `Profile *${code}* not found or no longer active.` };
  }

  const registered = !!ctx.seeker;
  const footer = registered
    ? `\nInterested? Type _interested ${profile.profile_code}_`
    : `\nInterested? Type _register_ first, then express your interest.`;

  return { reply: formatProfile(profile) + footer };
}
