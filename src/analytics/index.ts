/**
 * Analytics event data
 */
export interface AnalyticsEvent {
  name: string;
  action: string;
  component: string;
  action_name: string;
  class_name: string;
  method_name: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Send an analytics event
 * @param event - The event data to send
 */
export function sendAnalyticsEvent(event: AnalyticsEvent): void {
  // In a real implementation, this would send the event to an analytics service
  // For now, we just log it
  console.log("[Analytics Event]", event);
} 