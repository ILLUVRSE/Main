import Document, { Html, Head, Main, NextScript } from "next/document";

class MarketplaceDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta name="theme-color" content="#0f172a" />
        </Head>
        <body className="bg-slate-950 text-slate-50">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MarketplaceDocument;
