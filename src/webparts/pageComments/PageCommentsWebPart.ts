import * as React from "react";
import * as ReactDom from "react-dom";
import { Version } from "@microsoft/sp-core-library";
import {
  BaseClientSideWebPart,
  IPropertyPaneConfiguration,
  PropertyPaneTextField
} from "@microsoft/sp-webpart-base";
import { SPComponentLoader } from '@microsoft/sp-loader';
// PnPjs v3 imports:
import { spfi, SPFx, SPFI } from "@pnp/sp";
import "@pnp/sp/webs";
import "@pnp/sp/lists/web";
import "@pnp/sp/items/list";
import "@pnp/sp/site-users/web";
import "@pnp/sp/site-groups";

import SPHelper from "../../helpers/SPHelper";
import PageComments from "./components/PageComments";
import { IPageCommentsProps } from "./components/IPageCommentsProps";


export default class PageCommentsWebPart extends BaseClientSideWebPart<IPageCommentsProps> {
  // 1) Declare the SPFI field
  private sp: SPFI;
  private helper: SPHelper;

  // 2) Initialize PnPjs and your helper
  protected async onInit(): Promise<void> {
    await super.onInit();
    SPComponentLoader.loadCss(
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css'
    );
    // create a PnPjs SPFI instance wired to this SPFx context
    this.sp = spfi().using(SPFx(this.context));

    // pass that instance into your helper
    this.helper = new SPHelper(this.sp);

    // ensure the “Page Comments” list + fields exist
    await this.helper.ensureList();

    // await this.helper.resetList();

  }

  // 3) Render your React component
  public render(): void {
    const pageUrl = this.context.pageContext.legacyPageContext.serverRequestPath;
    const element: React.ReactElement<IPageCommentsProps> = React.createElement(
      PageComments,
      {
        pageUrl,
        helper: this.helper,
        datetimeFormat: this.properties.datetimeFormat
      }
    );
    ReactDom.render(element, this.domElement);
  }

  // 4) Unmount React on dispose
  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  // 5) SPFx versioning
  protected get dataVersion(): Version {
    return Version.parse("1.0");
  }

  // 6) Property pane to let the user change the date format
  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: "Page Comments Settings" },
          groups: [
            {
              groupName: "Appearance",
              groupFields: [
                PropertyPaneTextField("datetimeFormat", {
                  label: "Date/Time Format",
                  description: "Moment.js format, e.g. DD/MM/YYYY hh:mm A",
                  value: this.properties.datetimeFormat
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
