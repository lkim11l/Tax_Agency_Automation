import { parseAttachment } from "../src/modules/documents/orchestrator";

async function main() {
  const prefix = "--attachment-id=";
  const attachmentId = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);

  if (!attachmentId) {
    throw new Error("Usage: npm run documents:parse -- --attachment-id=<uuid>");
  }

  const parsed = await parseAttachment(attachmentId);
  if (!parsed) {
    throw new Error("Attachment is not pending or does not exist.");
  }
  console.log(
    JSON.stringify({
      attachment_id: parsed.attachmentId,
      status: parsed.result.status,
      error_code: parsed.result.errorCode ?? null,
      text_length: parsed.result.normalizedText?.length ?? 0,
    }),
  );
}

void main();
