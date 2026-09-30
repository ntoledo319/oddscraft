import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="apple-touch-icon" href="/logo.png" />
        {/* Jupiter Plugin, see https://dev.jup.ag/docs/tool-kits/plugin */}
        <script src="https://plugin.jup.ag/plugin-v1.js" data-preload defer />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
