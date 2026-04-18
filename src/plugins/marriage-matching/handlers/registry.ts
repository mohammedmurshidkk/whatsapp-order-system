// src/plugins/marriage-matching/handlers/registry.ts

import { MarriageIntentHandler } from './types';
import { SearchProfilesHandler } from './SearchProfilesHandler';
import { ShowProfileHandler } from './ShowProfileHandler';
import { ExpressInterestHandler } from './ExpressInterestHandler';
import { RegisterSeekerHandler } from './RegisterSeekerHandler';
import { CollectSeekerInfoHandler } from './CollectSeekerInfoHandler';
import { SmalltalkHandler, NoResultsHandler } from './SimpleHandlers';

const handlers: Record<string, MarriageIntentHandler> = {
  search_profiles: SearchProfilesHandler,
  show_profile: ShowProfileHandler,
  express_interest: ExpressInterestHandler,
  register_seeker: RegisterSeekerHandler,
  collect_seeker_info: CollectSeekerInfoHandler,
  no_results_found: NoResultsHandler,
  smalltalk: SmalltalkHandler,
};

export function getHandler(intent: string): MarriageIntentHandler | undefined {
  return handlers[intent];
}

export function hasHandler(intent: string): boolean {
  return intent in handlers;
}
