// src/plugins/marriage-matching/handlers/types.ts

import { Business } from '../../../types';
import { Seeker } from '../types';

export interface MarriageAIResponse {
  intent: string;
  reply: string;
  profile_codes?: string[];
  target_profile_code?: string;
  filters?: {
    gender?: string;
    religion?: string;
    religion_sect?: string;
    age_min?: number;
    age_max?: number;
    location_city?: string;
    location_district?: string;
    profession?: string;
    education?: string;
  };
}

export interface MarriageIntentContext {
  phone: string;
  businessId: string;
  business: Business;
  seeker: Seeker | null;
  message: string;
  aiResponse: MarriageAIResponse;
  sendMessage: (to: string, text: string) => Promise<void>;
}

export type MarriageIntentHandler = (ctx: MarriageIntentContext) => Promise<{ reply: string | null }>;
