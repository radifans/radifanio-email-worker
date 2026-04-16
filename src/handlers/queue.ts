import type { Env } from "../env";
import type { EmailProcessedEvent } from "../services/queue";

export async function handleQueue(
  batch: MessageBatch<EmailProcessedEvent>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const event = message.body;
      console.log(
        `Processing event: ${event.eventType} for email ${event.emailId} (type: ${event.typeId})`
      );
      // Future: OCR, data extraction, forwarding, etc.
      message.ack();
    } catch (err) {
      console.error("Queue message processing failed:", err);
      message.retry();
    }
  }
}
