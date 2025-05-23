import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import SPHelper, { IComment, IUserInfo } from "../../../helpers/SPHelper";
import { IPageCommentsProps } from "./IPageCommentsProps";
import styles from "./PageComments.module.scss";
import '@fortawesome/fontawesome-free/css/all.min.css';


// Generate UUIDs for new comments/replies
type Guid = string;
const guid = (): Guid => (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

const SORTS = ["Newest", "Oldest", "Popular"] as const;
type SortKey = typeof SORTS[number];

interface IItemProps {
  comment: IComment;
  pageUrl: string;
  user: IUserInfo;
  isAdmin: boolean;
  helper: SPHelper;
  reload: () => Promise<void>;
  parentAuthor?: string;
  depth?: number;
}

const CommentItem: React.FC<IItemProps> = ({
  comment,
  pageUrl,
  user,
  isAdmin,
  helper,
  reload,
  parentAuthor,
  depth = 0,
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.content);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showAll, setShowAll] = useState(false);

  const PREVIEW_COUNT = 3;
  const canDelete = user.ID === comment.userid || isAdmin;

  const upvote = async (): Promise<void> => {
    // flip the flag
    comment.user_has_upvoted = !comment.user_has_upvoted;
    // adjust count
    comment.upvote_count += comment.user_has_upvoted ? 1 : -1;
    // send the new state to the backend
    await helper.vote(pageUrl, comment, user);
    await reload();
  };
  


  const saveEdit = async (): Promise<void> => {
    comment.content = text;
    comment.modified = new Date().toISOString();
    await helper.edit(pageUrl, comment);
    setEditing(false);
    await reload();
  };

  const doDelete = async (): Promise<void> => {
    if (confirm("Delete this comment and its replies?")) {
      await helper.delete(pageUrl, comment);
      setEditing(false);
      await reload();
    }
  };

  const sendReply = async (): Promise<void> => {
    if (!replyText.trim()) return;
    const newReply: IComment = {
      id: guid(),
      parent: comment.id,
      content: replyText.trim(),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      fullname: user.DisplayName,
      userid: user.ID,
      upvote_count: 0,
      user_has_upvoted: false,
      is_new: true,
      pings: {},
      profile_picture_url: user.profile_picture_url,
      replies: [],
    };
    await helper.post(pageUrl, newReply);
    setReplyText("");
    setShowReplyBox(false);
    await reload();
  };

  const replies = comment.replies || [];

  return (
    <li className={styles.comment}>
      <div className={styles.commentHeader}>
        <img className={styles.avatar} src={comment.profile_picture_url!} alt="" />
        <div className={styles.meta}>
          <span className={styles.author}>{comment.fullname}</span>
          {depth >= 1 && parentAuthor && (
            <span className={styles.replyTo}>&rarr; {parentAuthor}</span>
          )}
          {comment.is_new && <span className={styles.newBadge}>New</span>}
        </div>
        <span className={styles.date}>
          {new Date(comment.created).toLocaleDateString()}
        </span>
      </div>

      {editing ? (
        <textarea
          className={styles.editArea}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <div className={styles.content}>{comment.content}</div>
      )}

      <div className={styles.actions}>
        {editing ? (
          <div className={styles.action2}>
            {canDelete && <button onClick={doDelete}>Delete</button>}
            <button onClick={saveEdit}>Save</button>

          </div>
        ) : (
          <>
            <button onClick={() => setShowReplyBox((s) => !s)}>
              {showReplyBox ? "Cancel" : "Reply"} .
            </button>

            <button className={styles.likeButton} onClick={upvote}>
              <i
                className={comment.user_has_upvoted ? 'fas fa-thumbs-up' : 'far fa-thumbs-up'}
                aria-hidden="true"
              />
              <span className={styles.voteCount}>{comment.upvote_count}</span>
            </button>


            <button onClick={() => setEditing(true)}>Edit</button>


          </>
        )}
      </div>

      {showReplyBox && (
        <div className={styles.replyBox}>
          <textarea
            rows={2}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply..."
          />
          <button onClick={sendReply} disabled={!replyText.trim()}>
            Send Reply
          </button>
        </div>
      )}

      {replies.length > 0 && (
        <>
          <ul className={depth === 0 ? styles.replies : styles.childReplies}>
            {(showAll ? replies : replies.slice(0, PREVIEW_COUNT)).map(
              (r) => (
                <CommentItem
                  key={r.id}
                  comment={r}
                  pageUrl={pageUrl}
                  user={user}
                  isAdmin={isAdmin}
                  helper={helper}
                  reload={reload}
                  parentAuthor={comment.fullname}
                  depth={depth + 1}
                />
              )
            )}
          </ul>
          {replies.length > PREVIEW_COUNT && (
            <button
              className={styles.toggleReplies}
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll
                ? "Hide replies"
                : `View ${replies.length - PREVIEW_COUNT} more replies`}
            </button>
          )}
        </>
      )}
    </li>
  );
};

const PageComments: React.FC<IPageCommentsProps> = ({
  pageUrl,
  helper,
  datetimeFormat = "MM/DD/YYYY hh:mm A",
}) => {
  const [user, setUser] = useState<IUserInfo | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [comments, setComments] = useState<IComment[]>([]);
  const [newText, setNewText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("Newest");

  const reload = useCallback(async (): Promise<void> => {
    if (!user) return;
    let all = await helper.fetchComments(pageUrl, user);
    if (sortKey === "Oldest") all = all.slice().reverse();
    else if (sortKey === "Popular") all = all.slice().sort((a, b) => b.upvote_count - a.upvote_count);
    const map: Record<string, IComment> = {};
    all.forEach((c) => (map[c.id] = { ...c, replies: [] }));
    all.forEach((c) => {
      if (c.parent && map[c.parent]) map[c.parent].replies!.push(map[c.id]);
    });
    setComments(Object.values(map).filter((c) => !c.parent));
  }, [helper, pageUrl, user, sortKey]);

  useEffect(() => {
    const init = async (): Promise<void> => {
      await helper.ensureList();
      const u = await helper.getCurrentUser();
      setUser(u);
      setIsAdmin(await helper.isAdmin());
      await reload();
    };
    void init();
  }, [helper, reload]);

  const post = async (): Promise<void> => {
    if (!newText.trim() || !user) return;
    const c: IComment = {
      id: guid(),
      parent: null,
      content: newText.trim(),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      fullname: user.DisplayName,
      userid: user.ID,
      upvote_count: 0,
      user_has_upvoted: false,
      is_new: true,
      pings: {},
      profile_picture_url: user.profile_picture_url,
      replies: []
    };
    await helper.post(pageUrl, c);
    setNewText("");
    await reload();
  };

  return (
    <div className={styles.pageComments}>
      <div className={styles.inputBar}>
        <img className={styles.avatar} src={user?.profile_picture_url} alt="" />
        <textarea
          className={styles.input}
          placeholder="Add a comment"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button className={styles.send} onClick={post}>Send</button>
      </div>
      <div className={styles.nav}>
        {SORTS.map((key) => (
          <button
            key={key}
            className={`${styles.navItem} ${sortKey === key ? styles.active : ""}`}
            onClick={() => setSortKey(key)}
          >{key}</button>
        ))}
      </div>
      <ul className={styles.commentList}>
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            pageUrl={pageUrl}
            user={user!}
            isAdmin={isAdmin}
            helper={helper}
            reload={reload}
            depth={0}
          />
        ))}
      </ul>
    </div>
  );
};

export default PageComments;
