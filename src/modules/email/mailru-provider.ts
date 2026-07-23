import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import { parseMimeMessage } from "./mime";
import type { EmailConfig } from "./config";
import type {
  EmailProvider,
  MailboxSnapshot,
  OutboundEmail,
  OutboundSendResult,
} from "./types";

export class MailruEmailProvider implements EmailProvider {
  readonly name = "mailru";
  private imap: ImapFlow | null = null;

  constructor(private readonly config: EmailConfig) {}

  private createImapClient() {
    const client = new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.secure,
      auth: {
        user: this.config.imap.username,
        pass: this.config.imap.password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      logger: false,
      socketTimeout: 30_000,
    });
    client.on("error", () => {
      // Connection promises surface categorized errors to the caller. The
      // listener prevents a late socket error from becoming an unhandled event.
    });
    return client;
  }

  private async connectedImap() {
    if (this.imap?.usable) {
      return this.imap;
    }
    this.imap = this.createImapClient();
    await this.imap.connect();
    return this.imap;
  }

  async verifyImap(): Promise<void> {
    const client = await this.connectedImap();
    await client.mailboxOpen(this.config.imap.folder, { readOnly: true });
  }

  async verifySmtp(): Promise<void> {
    const transport = this.createSmtpTransport();
    await transport.verify();
    transport.close();
  }

  private createSmtpTransport() {
    return nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.username,
        pass: this.config.smtp.password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async sendMessage(message: OutboundEmail): Promise<OutboundSendResult> {
    const transport = this.createSmtpTransport();
    try {
      const result = await transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: message.messageId,
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references,
        attachments: message.attachments,
      });
      return {
        messageId: result.messageId,
        response: result.response,
        accepted: result.accepted.map(String),
        rejected: result.rejected.map(String),
      };
    } finally {
      transport.close();
    }
  }

  async fetchIncoming(afterUid: number): Promise<MailboxSnapshot> {
    const client = await this.connectedImap();
    const mailbox = await client.mailboxOpen(this.config.imap.folder, {
      readOnly: true,
    });
    const uidValidity = mailbox.uidValidity.toString();
    const messages = [];
    const uids = await client.search(
      { uid: `${Math.max(1, afterUid + 1)}:*` },
      { uid: true },
    );

    for (const uid of uids || []) {
      if (uid <= afterUid) {
        continue;
      }
      const fetched = await client.fetchOne(
        uid,
        { source: true, internalDate: true, uid: true },
        { uid: true },
      );
      if (!fetched || !fetched.source) {
        throw new Error(`IMAP message UID ${uid} did not include MIME source.`);
      }
      messages.push(
        await parseMimeMessage({
          source: fetched.source,
          uid,
          uidValidity,
          fallbackDate: fetched.internalDate
            ? new Date(fetched.internalDate)
            : undefined,
        }),
      );
    }

    return {
      mailboxIdentifier: this.config.from.toLowerCase(),
      folder: this.config.imap.folder,
      uidValidity,
      messages,
    };
  }

  async fetchByUid(uid: number): Promise<MailboxSnapshot> {
    const client = await this.connectedImap();
    const mailbox = await client.mailboxOpen(this.config.imap.folder, {
      readOnly: true,
    });
    const uidValidity = mailbox.uidValidity.toString();
    const fetched = await client.fetchOne(
      uid,
      { source: true, internalDate: true, uid: true },
      { uid: true },
    );
    if (!fetched || !fetched.source) {
      throw new Error(`IMAP message UID ${uid} was not found.`);
    }
    return {
      mailboxIdentifier: this.config.from.toLowerCase(),
      folder: this.config.imap.folder,
      uidValidity,
      messages: [
        await parseMimeMessage({
          source: fetched.source,
          uid,
          uidValidity,
          fallbackDate: fetched.internalDate
            ? new Date(fetched.internalDate)
            : undefined,
        }),
      ],
    };
  }

  async close(): Promise<void> {
    const client = this.imap;
    this.imap = null;
    try {
      if (client?.usable) {
        await client.logout();
      }
    } catch {
      try {
        client?.close();
      } catch {
        // The socket is already unusable; no business operation remains.
      }
    }
  }
}
