/**
 * Read-side wrapper over Exchange Web Services for the import mailbox.
 *
 * EWS rather than IMAP because IMAP and POP3 are both closed on the mail server
 * (only 443 and 25 are open), and EWS is already reachable there over HTTPS with
 * NTLM. The EWS retirement Microsoft is enforcing through 2026 applies to
 * Exchange Online only; on-premises Exchange is explicitly out of scope, so this
 * is not a dead end.
 *
 * Deliberately narrow: find unread mail, read its attachments, mark it read, move
 * it to a subfolder. It never deletes anything, so any mistake this makes is
 * recoverable from the mailbox itself.
 *
 * The library's typings are loose in places (attachment content and the DateTime
 * wrapper especially), so a few reads go through `any` with a defensive shape
 * check rather than trusting a single property name.
 */

import {
  BasePropertySet,
  ConfigurationApi,
  ConflictResolutionMode,
  EmailMessage,
  EmailMessageSchema,
  EwsLogging,
  ExchangeService,
  ExchangeVersion,
  FileAttachment,
  Folder,
  FolderSchema,
  FolderView,
  ItemId,
  ItemSchema,
  ItemView,
  PropertySet,
  SearchFilter,
  Uri,
  WebCredentials,
  WellKnownFolderName,
} from 'ews-javascript-api';
import { XhrApi } from '@ewsjs/xhr';
import logger from '../../config/logger';
import { mailboxImportConfig } from '../../config/environment';

/** Extensions we will even look at. Paychex mislabels its xlsx as
 *  `application/ms-excel`, so the MIME type is not usable for this. */
const SPREADSHEET_EXT = /\.(xlsx|xls)$/i;

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
}

export interface MailAttachment {
  name: string;
  content: Buffer;
}

export interface MailDetail {
  /**
   * The gateway's verdict on SPF/DKIM/DMARC, or null when the gateway does not
   * stamp one. Null means "unknown", never "passed".
   */
  authenticationResults: string | null;
  attachments: MailAttachment[];
  /** Attachment names that were skipped for not being a spreadsheet. */
  ignored: string[];
}

/**
 * Read a complex-property collection's items.
 *
 * `Items` is a real getter on every one of these collections at runtime, but the
 * library's shipped typings omit it from `AttachmentCollection`, so going through
 * the property directly does not compile.
 */
function collectionItems<T>(collection: unknown): T[] {
  const items = (collection as { Items?: T[] } | null | undefined)?.Items;
  return Array.isArray(items) ? items : [];
}

/** The EWS DateTime wrapper is not a JS Date. Convert whatever we are handed. */
function toDate(value: any): Date {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value.ToISOString === 'function') return new Date(value.ToISOString());
  if (value.MomentDate && typeof value.MomentDate.toDate === 'function') {
    return value.MomentDate.toDate();
  }
  return new Date(String(value));
}

export class ExchangeMailClient {
  private constructor(private readonly service: ExchangeService) {}

  /** Null when the mailbox is not configured, so callers can simply not run. */
  static fromConfig(): ExchangeMailClient | null {
    const { enabled, ewsUrl, user, password } = mailboxImportConfig;
    if (!enabled) return null;
    if (!user || !password) {
      logger.warn('[MAILBOX] EXCHANGE_EWS_URL is set but EXCHANGE_USER/PASSWORD is not — poller disabled');
      return null;
    }

    // The library logs every SOAP envelope at debug otherwise, which would bury
    // the application log in message bodies.
    EwsLogging.DebugLogEnabled = false;

    // NTLM lives in the XHR layer rather than on the service. ConfigureXHR is
    // global, which is acceptable because this is the only consumer of EWS in
    // the app. No gzip flag needed: @ewsjs/xhr v3 runs on axios, which negotiates
    // encoding itself. (v2 needed `{ gzip: true }` or replies failed to parse.)
    const xhr = new XhrApi().useNtlmAuthentication(user, password);
    ConfigurationApi.ConfigureXHR(xhr);

    const service = new ExchangeService(ExchangeVersion.Exchange2013_SP1);
    service.Credentials = new WebCredentials(user, password);
    service.Url = new Uri(ewsUrl);

    return new ExchangeMailClient(service);
  }

  /**
   * Unread mail in the Inbox, OLDEST FIRST.
   *
   * The order matters. The punch report arrives repeatedly with an identical
   * subject and filename, and `punch_raw` heals in place on Post ID, so the
   * freshest file has to be imported last or a stale copy overwrites good rows.
   */
  async findUnread(max = 25): Promise<MailMessage[]> {
    const view = new ItemView(max);
    view.PropertySet = new PropertySet(
      BasePropertySet.IdOnly,
      ItemSchema.Subject,
      ItemSchema.DateTimeReceived,
      EmailMessageSchema.From,
    );

    const found = await this.service.FindItems(
      WellKnownFolderName.Inbox,
      new SearchFilter.IsEqualTo(EmailMessageSchema.IsRead, false),
      view,
    );

    return found.Items
      .map((item: any) => ({
        id: item.Id.UniqueId as string,
        from: String(item.From?.Address ?? '').trim().toLowerCase(),
        subject: String(item.Subject ?? ''),
        receivedAt: toDate(item.DateTimeReceived),
      }))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  /** Spreadsheet attachments plus the gateway's authentication verdict. */
  async loadDetail(messageId: string): Promise<MailDetail> {
    const message = await EmailMessage.Bind(
      this.service,
      new ItemId(messageId),
      new PropertySet(
        BasePropertySet.IdOnly,
        ItemSchema.Attachments,
        ItemSchema.InternetMessageHeaders,
      ),
    );

    const attachments: MailAttachment[] = [];
    const ignored: string[] = [];

    for (const attachment of collectionItems<any>(message.Attachments)) {
      if (!(attachment instanceof FileAttachment)) {
        ignored.push(attachment.Name ?? '(unnamed)');
        continue;
      }
      const name = attachment.Name ?? '';
      if (!SPREADSHEET_EXT.test(name)) {
        ignored.push(name || '(unnamed)');
        continue;
      }
      await attachment.Load();
      const content = this.readAttachment(attachment);
      if (content) attachments.push({ name, content });
      else ignored.push(name);
    }

    return {
      authenticationResults: this.findHeader(message, 'Authentication-Results'),
      attachments,
      ignored,
    };
  }

  /**
   * Claim a message by marking it read. Done BEFORE importing, so a slow or
   * crashed run cannot cause the same file to be imported twice — the next poll
   * asks for unread mail and no longer sees it.
   */
  async markRead(messageId: string): Promise<void> {
    const message = await EmailMessage.Bind(this.service, new ItemId(messageId));
    message.IsRead = true;
    await message.Update(ConflictResolutionMode.AutoResolve);
  }

  /** Move a message into a named subfolder of the Inbox, creating it if needed. */
  async moveToFolder(messageId: string, folderName: string): Promise<void> {
    const folderId = await this.ensureInboxSubfolder(folderName);
    const message = await EmailMessage.Bind(this.service, new ItemId(messageId));
    await message.Move(folderId);
  }

  private async ensureInboxSubfolder(displayName: string): Promise<any> {
    const view = new FolderView(1);
    const found = await this.service.FindFolders(
      WellKnownFolderName.Inbox,
      new SearchFilter.IsEqualTo(FolderSchema.DisplayName, displayName),
      view,
    );
    if (found.Folders.length > 0) return found.Folders[0].Id;

    const folder = new Folder(this.service);
    folder.DisplayName = displayName;
    await folder.Save(WellKnownFolderName.Inbox);
    logger.info(`[MAILBOX] created Inbox subfolder "${displayName}"`);
    return folder.Id;
  }

  /**
   * Attachment bytes. The library has exposed these as base64 under more than
   * one property name across versions, so check rather than assume.
   */
  private readAttachment(attachment: FileAttachment): Buffer | null {
    const raw = (attachment as any).Base64Content ?? (attachment as any).Content;
    if (!raw) return null;
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    return Buffer.from(String(raw), 'base64');
  }

  private findHeader(message: EmailMessage, name: string): string | null {
    const wanted = name.toLowerCase();
    for (const header of collectionItems<any>(message.InternetMessageHeaders)) {
      if (String(header.Name ?? '').toLowerCase() === wanted) return String(header.Value ?? '');
    }
    return null;
  }
}
