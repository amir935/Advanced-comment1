import { SPFI } from "@pnp/sp";
import { IList } from "@pnp/sp/lists";
import "@pnp/sp/webs";
import "@pnp/sp/lists/web";
import "@pnp/sp/items";
import "@pnp/sp/fields";
import "@pnp/sp/views";
import "@pnp/sp/site-users/web";
import "@pnp/sp/site-groups";

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
      EnableAttachments: false,
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
    if (u.IsSiteAdmin) return true;
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

  /** Fetch comments & likes for a given page URL */
  public async fetchComments(
    pageUrl: string,
    user: IUserInfo
  ): Promise<IComment[]> {
    const res = await this.list.items
      .select(
        "Comments",
        "FieldValuesAsText/Comments",
        "Likes",
        "FieldValuesAsText/Likes"
      )
      .filter(`PageURL eq '${pageUrl}'`)
      .expand("FieldValuesAsText")();

    if (res.length === 0) return [];

    const comments = JSON.parse(
      res[0].FieldValuesAsText.Comments || "[]"
    ) as IComment[];

    const likes = JSON.parse(
      res[0].FieldValuesAsText.Likes || "[]"
    ) as IVoteRecord[];

    // Merge vote counts and user-specific state
    likes.forEach((l) => {
      const c = comments.find((x) => x.id === l.commentID);
      if (c) {
        c.upvote_count = l.userVote.length;
        c.user_has_upvoted = l.userVote.some(
          (v) => v.userid === user.ID
        );
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

  /** Toggle a vote for a comment */
  public async vote(
    pageUrl: string,
    comment: IComment,
    user: IUserInfo
  ): Promise<void> {
    const res = await this.list.items
      .select("Likes", "FieldValuesAsText/Likes")
      .filter(`PageURL eq '${pageUrl}'`)
      .expand("FieldValuesAsText")();

    const raw = JSON.parse(
      res[0].FieldValuesAsText.Likes || "[]"
    ) as Array<{ commentID: string; userVote: { userid: number }[] }>;

    let entry = raw.find((l) => l.commentID === comment.id);
    if (!entry && comment.user_has_upvoted) {
      entry = { commentID: comment.id, userVote: [] };
      raw.push(entry);
    }
    if (entry) {
      const has = entry.userVote.some((v) => v.userid === user.ID);
      if (comment.user_has_upvoted && !has) {
        entry.userVote.push({ userid: user.ID });
      } else if (!comment.user_has_upvoted && has) {
        entry.userVote = entry.userVote.filter(
          (v) => v.userid !== user.ID
        );
      }
    }

    await this.list.items
      .getById(res[0].ID)
      .update({ Likes: JSON.stringify(raw) });
  }
}
