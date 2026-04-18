// src/plugins/marriage-matching/handlers/ExpressInterestHandler.ts

import { MarriageIntentContext } from './types';
import { getProfileByCode } from '../services/profileService';
import { createInterestRequest } from '../services/interestService';

export async function ExpressInterestHandler(ctx: MarriageIntentContext) {
  if (!ctx.seeker) {
    return {
      reply: "To express interest, please register first. Type _register_ to begin.",
    };
  }

  if (ctx.seeker.is_blocked) {
    return { reply: "Your account has been restricted. Please contact the admin." };
  }

  const code = ctx.aiResponse.target_profile_code
    ?? ctx.message.match(/#[MF]\d+/i)?.[0];

  if (!code) {
    return { reply: "Please specify a profile code, e.g. _interested #M042_" };
  }

  const profile = await getProfileByCode(ctx.businessId, code.toUpperCase());

  if (!profile) {
    return { reply: `Profile *${code}* not found or no longer active.` };
  }

  try {
    await createInterestRequest(ctx.businessId, ctx.seeker.id, profile.id);
  } catch (err: any) {
    if (err.message === 'DUPLICATE_INTEREST') {
      return { reply: `You've already expressed interest in *${profile.profile_code}*. The admin will contact you.` };
    }
    throw err;
  }

  return {
    reply: `Your interest in *${profile.profile_code}* has been sent to the admin. 📩\n\nThe admin will contact you if there's a match. Thank you!`,
  };
}
