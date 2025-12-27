/**
 * Common types and interfaces for WhatsApp providers
 * Used by both Meta API and whatsapp-web.js implementations
 */

// Button for interactive messages
export interface ReplyButton {
  id: string;
  title: string;
}

// Row for list messages
export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

// Section for list messages
export interface ListSection {
  title: string;
  rows: ListRow[];
}

// Location data
export interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
  name?: string;
}

// Incoming message types
export type IncomingMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'voice'
  | 'location'
  | 'interactive'
  | 'unknown';

// Normalized incoming message (provider-agnostic)
export interface IncomingMessage {
  type: IncomingMessageType;
  from: string;           // Phone number (without @c.us or country formatting)
  businessPhone: string;  // The business phone that received this
  text?: string;          // For text messages
  location?: LocationData;
  mediaId?: string;       // For audio/image
  caption?: string;       // For image with caption
  interactiveType?: 'button_reply' | 'list_reply';
  interactiveId?: string; // Button ID or list item ID
  raw?: unknown;          // Original raw message for debugging
}

// Provider interface - what each provider must implement
export interface WhatsAppProvider {
  // Send a text message
  sendMessage(to: string, message: string): Promise<void>;

  // Send reply buttons (will be text fallback for webjs)
  sendReplyButtons(to: string, body: string, buttons: ReplyButton[]): Promise<void>;

  // Send interactive list (will be text fallback for webjs)
  sendInteractiveList(
    to: string,
    header: string,
    body: string,
    buttonText: string,
    sections: ListSection[]
  ): Promise<void>;

  // Send location request (will be text fallback for webjs)
  sendLocationRequest(to: string, body: string): Promise<void>;
}

// Provider status
export interface ProviderStatus {
  ready: boolean;
  provider: 'meta' | 'webjs';
  needsAuth?: boolean;
  error?: string;
}
