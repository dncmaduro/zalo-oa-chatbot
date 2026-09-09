export interface ZaloUserTextEvent {
  eventName: 'user_send_text';
  externalEventKey: string;
  externalMessageId: string;
  externalUserId: string;
  oaId: string;
  text: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface ZaloDeliveryResult { externalMessageId: string | null; }
