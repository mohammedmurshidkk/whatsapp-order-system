// src/plugins/marriage-matching/handlers/CollectSeekerInfoHandler.ts

import { MarriageIntentContext } from './types';
import { updateSeeker } from '../services/seekerService';
import { RegistrationStep } from '../types';

const NEXT_QUESTION: Record<RegistrationStep, string> = {
  name: "Great! How old are you? _(Enter your age)_",
  age: "Are you *male* or *female*? _(Type male or female)_",
  gender: "What is your *religion*? _(e.g. Muslim, Hindu, Christian)_",
  religion: "What *sect* or denomination? _(e.g. Sunni, Shia, or type 'skip')_",
  religion_sect: "Which *city and country* are you from? _(e.g. Dubai, UAE)_",
  location: "What is your *profession*? _(e.g. Engineer, Teacher, or type 'skip')_",
  profession: "✅ *Registration complete!* You can now search for profiles or express interest.\n\nType something like: _'Sunni Muslim girl, age 22-28, Dubai'_",
  done: "",
};

export async function CollectSeekerInfoHandler(ctx: MarriageIntentContext) {
  if (!ctx.seeker) return { reply: null };

  const seeker = ctx.seeker;
  const input = ctx.message.trim().toLowerCase();

  let step: RegistrationStep = 'name';
  let updateData: Record<string, any> = {};

  if (!seeker.name) {
    step = 'name';
    updateData.name = ctx.message.trim();
  } else if (!seeker.age) {
    step = 'age';
    const age = parseInt(ctx.message.trim());
    if (isNaN(age) || age < 18 || age > 80) return { reply: "Please enter a valid age (18–80)." };
    updateData.age = age;
  } else if (!seeker.gender) {
    step = 'gender';
    if (!['male', 'female'].includes(input)) return { reply: "Please type _male_ or _female_." };
    updateData.gender = input;
  } else if (!seeker.religion) {
    step = 'religion';
    updateData.religion = ctx.message.trim();
  } else if (!seeker.religion_sect) {
    step = 'religion_sect';
    updateData.religion_sect = input === 'skip' ? null : ctx.message.trim();
  } else if (!seeker.location_city) {
    step = 'location';
    const [city, ...countryParts] = ctx.message.split(',');
    updateData.location_city = city.trim();
    if (countryParts.length) updateData.location_country = countryParts.join(',').trim();
  } else if (!seeker.profession) {
    step = 'profession';
    updateData.profession = input === 'skip' ? null : ctx.message.trim();
    updateData.profile_submitted = true;
  } else {
    return { reply: "You're already registered! Type your search to find profiles." };
  }

  await updateSeeker(seeker.id, seeker.business_id, updateData);

  return { reply: NEXT_QUESTION[step] };
}
