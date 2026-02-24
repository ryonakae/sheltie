/// <reference types="electron" />

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<Electron.WebviewTag> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          webpreferences?: string;
          preload?: string;
          ref?: React.Ref<Electron.WebviewTag>;
        },
        Electron.WebviewTag
      >;
    }
  }
}
