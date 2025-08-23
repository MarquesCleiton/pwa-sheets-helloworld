declare namespace gapi {
  namespace client {
    namespace sheets {
      namespace spreadsheets {
        namespace values {
          function append(
            request: {
              spreadsheetId: string;
              range: string;
              valueInputOption: string;
            },
            body: {
              values: any[][];
            }
          ): Promise<any>;
        }
      }
    }
  }
}
