// src/plugins/marriage-matching/handlers/RegisterSeekerHandler.ts

import { MarriageIntentContext } from './types';

export async function RegisterSeekerHandler(ctx: MarriageIntentContext) {
  if (ctx.seeker?.profile_submitted) {
    return { reply: "You're already registered! You can search for profiles or express interest in one." };
  }

  return {
    reply: `Let's get you registered! 📝\n\nFirst, what is your *name*?\n_(Type your name to continue)_`,
  };
}
