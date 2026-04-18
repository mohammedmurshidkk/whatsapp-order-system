// src/plugins/marriage-matching/handlers/SimpleHandlers.ts

import { MarriageIntentContext } from './types';

export async function SmalltalkHandler(ctx: MarriageIntentContext) {
  return { reply: ctx.aiResponse.reply || "Hello! How can I help you today? You can search for profiles or type _register_ to get started." };
}

export async function NoResultsHandler(_ctx: MarriageIntentContext) {
  return {
    reply: "No profiles matched your search. Try broadening your criteria — for example, a wider age range, different location, or remove the sect filter.",
  };
}
