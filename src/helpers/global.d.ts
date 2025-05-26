// global.d.ts
import "@pnp/sp/attachments";

declare module "@pnp/sp/attachments" {
  interface IAttachmentFileInfo {
    ServerRelativeUrl: string;
  }
}
