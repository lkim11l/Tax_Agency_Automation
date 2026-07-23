export type EmailAddress = {
  address: string;
  name?: string;
};

export type EmailAttachment = {
  content: Buffer;
  contentId?: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type ProviderMessage = {
  uid: number;
  uidValidity: string;
  providerMessageId: string;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  sender: EmailAddress;
  recipients: EmailAddress[];
  cc: EmailAddress[];
  subject: string | null;
  plainBody: string | null;
  htmlBody: string | null;
  receivedAt: Date;
  rawHeaders: Record<string, string>;
  attachments: EmailAttachment[];
};

export type MailboxSnapshot = {
  mailboxIdentifier: string;
  folder: string;
  uidValidity: string;
  messages: ProviderMessage[];
};

export interface EmailProvider {
  readonly name: string;
  verifyImap(): Promise<void>;
  verifySmtp(): Promise<void>;
  fetchIncoming(afterUid: number): Promise<MailboxSnapshot>;
  fetchByUid(uid: number): Promise<MailboxSnapshot>;
  sendMessage(message: OutboundEmail): Promise<OutboundSendResult>;
  close(): Promise<void>;
}

export type OutboundEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
};

export type OutboundSendResult = {
  messageId: string;
  response: string;
  accepted: string[];
  rejected: string[];
};

export type IngestionResult = {
  applicationCreated: number;
  attachmentsStored: number;
  duplicateSkipped: number;
  errors: number;
  ignored: number;
  messagesProcessed: number;
  repliesLinked: number;
  unlinkedReplies: number;
  linkedReplyMessageIds: string[];
};
