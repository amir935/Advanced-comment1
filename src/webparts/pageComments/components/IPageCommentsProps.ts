import SPHelper, { IUserInfo } from "../../../helpers/SPHelper";

export interface IPageCommentsProps {
  pageUrl: string;
  helper: SPHelper;
  datetimeFormat?: string;
  currentUser?: IUserInfo;
  isAdmin?: boolean;
}
