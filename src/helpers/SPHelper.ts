import { SPFI } from "@pnp/sp";
import { IList } from "@pnp/sp/lists";
import "@pnp/sp/webs";
import "@pnp/sp/lists/web";
import "@pnp/sp/items";
import "@pnp/sp/fields";
import "@pnp/sp/views";
import "@pnp/sp/site-users/web";
import "@pnp/sp/site-groups";
import "@pnp/sp/folders";    // ← add this
import "@pnp/sp/files";
import "@pnp/sp/items";
import "@pnp/sp/attachments";

export interface IUserInfo {
  ID: number;
  DisplayName: string;
  Email: string;
  profile_picture_url: string;
}

interface IUserVote {
  userid: number;
}

interface IVoteRecord {
  commentID: string;
  userVote: IUserVote[];
}

export interface IComment {
  id: string;
  parent: string | null;
  content: string;
  created: string;
  modified: string;
  fullname: string;
  userid: number;
  upvote_count: number;
  user_has_upvoted: boolean;
  is_new: boolean;
  pings: Record<string, string>;
  profile_picture_url?: string;
  replies?: IComment[];
  attachments?: { name: string; url: string }[];
}

export default class SPHelper {
  private listName = "Page Comments";

  constructor(private sp: SPFI) {}

  /** Returns the PnPjs list pipeline */
  private get list(): IList {
    return this.sp.web.lists.getByTitle(this.listName);
  }

  /** Ensure the list exists, configure columns and view safely */
  public async ensureList(): Promise<void> {
    const { created, list } = await this.sp.web.lists.ensure(this.listName);

    // Disable versioning & attachments to reduce hidden columns
    await list.update({
      EnableVersioning: false,
      EnableAttachments: true,
    });

    // Helper: check if a field already exists
    const fieldExists = async (internalName: string): Promise<boolean> => {
      try {
        await list.fields.getByInternalNameOrTitle(internalName).select("Title")();
        return true;
      } catch {
        return false;
      }
    };

    // PageURL single-line text
    if (!(await fieldExists("PageURL"))) {
      await list.fields.addText("PageURL", {
        Required: true,
        MaxLength: 255,
      });
    }

    // Comments: multi-line text with unlimited length stored externally
    if (!(await fieldExists("Comments"))) {
      await list.fields.createFieldAsXml(
        `<Field DisplayName="Comments" Name="Comments" Type="Note" NumLines="6" UnlimitedLengthInDocumentLibrary="TRUE" />`
      );
    }

    // Likes: multi-line text with unlimited length stored externally
    if (!(await fieldExists("Likes"))) {
      await list.fields.createFieldAsXml(
        `<Field DisplayName="Likes" Name="Likes" Type="Note" NumLines="6" UnlimitedLengthInDocumentLibrary="TRUE" />`
      );
    }

    // Only add to view when the list was first created
    if (created) {
      const view = list.views.getByTitle("All Items");
      await view.fields.add("PageURL");
      await view.fields.add("Comments");
      await view.fields.add("Likes");
    }
  }

  /** Get current user information */
  public async getCurrentUser(): Promise<IUserInfo> {
    const u = await this.sp.web.currentUser();
    return {
      ID: u.Id,
      DisplayName: u.Title,
      Email: u.Email,
      profile_picture_url: `/_layouts/15/userphoto.aspx?size=S&username=${u.UserPrincipalName}`,
    };
  }

  /** Check if current user is site admin or in Comment Administrators group */
  public async isAdmin(): Promise<boolean> {
    const u = await this.sp.web.currentUser();
    //if (u.IsSiteAdmin) return true;
    try {
      const members = await this.sp.web.siteGroups
        .getByName("Comment Administrators")
        .users();
      return members.some(
        (m: { Id: number; Email: string }) =>
          m.Id === u.Id ||
          m.Email?.toLowerCase() === u.Email?.toLowerCase()
      );
    } catch {
      return false;
    }
  }





public async fetchComments(
  pageUrl: string,
  user: IUserInfo
): Promise<IComment[]> {
  // 1) Load the single “Page Comments” list item for this page
  const items = await this.list.items
    .select("ID", "FieldValuesAsText/Comments", "FieldValuesAsText/Likes")
    .filter(`PageURL eq '${pageUrl}'`)
    .expand("FieldValuesAsText")();

  if (items.length === 0) {
    return [];
  }
  const item = items[0];
  const itemId = item.ID;

  // 2) Parse the stored JSON blobs
  const comments = JSON.parse(
    item.FieldValuesAsText.Comments || "[]"
  ) as IComment[];
  const likes = JSON.parse(
    item.FieldValuesAsText.Likes || "[]"
  ) as IVoteRecord[];

  // 3) Fetch all attachments on that list item
  const files = await this.list.items.getById(itemId).attachmentFiles();

  // 4) For each comment, pick out its own attachments by matching the prefix
  comments.forEach(c => {
    const myFiles = files.filter(f => f.FileName.startsWith(`${c.id}_`));
    c.attachments = myFiles.map(f => ({
      name: f.FileName.replace(`${c.id}_`, ""),
      url: window.location.origin + (f as any).ServerRelativeUrl
    }));
  });

  // 5) Merge in vote counts + user-specific upvoted flag
  likes.forEach(record => {
    const c = comments.find(x => x.id === record.commentID);
    if (c) {
      c.upvote_count = record.userVote.length;
      c.user_has_upvoted = record.userVote.some(v => v.userid === user.ID);
    }
  });

  return comments;
}



  /** Internal: add or update the single list item storing comments */
  private async saveComments(
    pageUrl: string,
    comments: IComment[]
  ): Promise<void> {
    const items = await this.list.items
      .filter(`PageURL eq '${pageUrl}'`)();

    if (items.length > 0) {
      await this.list.items
        .getById(items[0].ID)
        .update({ Comments: JSON.stringify(comments) });
    } else {
      await this.list.items.add({
        Title: pageUrl.split("/").pop() || pageUrl,
        PageURL: pageUrl,
        Comments: JSON.stringify(comments),
      });
    }
  }

  /** Post a new comment */
  public async post(pageUrl: string, comment: IComment): Promise<void> {
    const all = await this.fetchComments(pageUrl, comment as any);
    all.push(comment);
    await this.saveComments(pageUrl, all);
  }

  /** Edit an existing comment */
  public async edit(pageUrl: string, comment: IComment): Promise<void> {
    const all = await this.fetchComments(pageUrl, comment as any);
    const idx = all.findIndex((c) => c.id === comment.id);
    if (idx > -1) {
      all[idx] = { ...all[idx], ...comment };
      await this.saveComments(pageUrl, all);
    }
  }

  /** Delete a comment and its nested replies */
  public async delete(pageUrl: string, comment: IComment): Promise<void> {
    const all = await this.fetchComments(pageUrl, comment as any);
    const toRemove = new Set<string>();
    const collect = (id: string) => {
      toRemove.add(id);
      all.filter((c) => c.parent === id).forEach((r) => collect(r.id));
    };
    collect(comment.id);
    await this.saveComments(
      pageUrl,
      all.filter((c) => !toRemove.has(c.id))
    );
  }

  /** Upload one file into the “CommentUploads” library, under a folder for this page+comment */



public async uploadCommentFile(
  pageUrl: string,
  commentId: string,
  file: File
): Promise<{ name: string; url: string }> {
  // 1) Find the Page Comments list‐item
  const items = await this.list.items.filter(`PageURL eq '${pageUrl}'`)();
  if (!items.length) {
    throw new Error("No comments item found for this page");
  }
  const itemId = items[0].ID;

  // 2) Upload, with the commentId prefix
  const attachmentName = `${commentId}_${file.name}`;
  const addRes = await this.list
    .items.getById(itemId)
    .attachmentFiles.add(attachmentName, file);

  // 3) Build the public URL
  const serverRel = (addRes.data as any).ServerRelativeUrl;
  return {
    name: file.name,
    url: window.location.origin + serverRel
  };
}







/** Always add a vote (never remove it) */
/** Always add a vote, never remove it */
// public async vote(
//   pageUrl: string,
//   comment: IComment,
//   user: IUserInfo
// ): Promise<void> {
//   // 1) load the list item storing Likes JSON, INCLUDING its ID
//   const res = await this.list.items
//     .select("ID", "Likes", "FieldValuesAsText/Likes")
//     .filter(`PageURL eq '${pageUrl}'`)
//     .expand("FieldValuesAsText")();

//   if (res.length === 0) {
//     // no list item yet? you might want to bail or create it here
//     return;
//   }

//   const listItemId = res[0].ID;

//   // 2) parse the existing Likes array
//   const raw: Array<{ commentID: string; userVote: { userid: number }[] }> =
//     JSON.parse(res[0].FieldValuesAsText.Likes || "[]");

//   // 3) find or create the entry for this comment
//   let entry = raw.find((l) => l.commentID === comment.id);
//   if (!entry) {
//     entry = { commentID: comment.id, userVote: [] };
//     raw.push(entry);
//   }

//   // 4) only add your vote (never remove)
//   if (!entry.userVote.some((v) => v.userid === user.ID)) {
//     entry.userVote.push({ userid: user.ID });
//   }

//   // 5) persist the updated array back to the same item
//   await this.list.items.getById(listItemId).update({
//     Likes: JSON.stringify(raw),
//   });
// }

public async vote(
  pageUrl: string,
  comment: IComment,
  user: IUserInfo
): Promise<void> {
  // 1) fetch the single list item, including its ID
  const res = await this.list.items
    .select("ID", "Likes", "FieldValuesAsText/Likes")
    .filter(`PageURL eq '${pageUrl}'`)
    .expand("FieldValuesAsText")();

  if (res.length === 0) return;
  const itemId = res[0].ID;

  // 2) parse the raw Likes array
  const raw: Array<{ commentID: string; userVote: { userid: number }[] }> =
    JSON.parse(res[0].FieldValuesAsText.Likes || "[]");

  // 3) find or create this comment's record
  let entry = raw.find(l => l.commentID === comment.id);
  if (!entry) {
    entry = { commentID: comment.id, userVote: [] };
    raw.push(entry);
  }

  const hasVoted = entry.userVote.some(v => v.userid === user.ID);

  // 4) toggle: add if now upvoted, else remove
  if (comment.user_has_upvoted && !hasVoted) {
    entry.userVote.push({ userid: user.ID });
  } else if (!comment.user_has_upvoted && hasVoted) {
    entry.userVote = entry.userVote.filter(v => v.userid !== user.ID);
  }

  // 5) write it back
  await this.list.items.getById(itemId).update({
    Likes: JSON.stringify(raw),
  });
}





}
