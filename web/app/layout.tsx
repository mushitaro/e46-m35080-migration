import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';

/* globals.css maps --font-sans / --font-mono onto these variables. A dangling
   var() there would make font-family invalid at computed-value time and the
   whole mono/sans split would silently fall back. */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'E46 M35080 /// Migration — PREVIEW',
  applicationName: 'E46 M35080 /// Migration — PREVIEW',
  description:
    'Read, back up, rewrite and reset the M35080 EEPROM in a BMW E46 instrument cluster.' +
    ' — PREVIEW BUILD, not the production tool.',
  manifest: './manifest.webmanifest',
  /* What this build IS, readable from the served HTML without opening the
     app. The skill's architecture injects this AFTER the build so one
     compiled output can serve every environment; there is no branding step
     in this repo yet, so it is static and honest rather than absent. */
  other: { 'app-variant': 'preview' },
  /* From M ICON, not from the repo's mark generator: the three-stripe SVG
     is the mark INSIDE the app, and shipping it as the OS icon is the
     mix-up tsunagi-m-release section 4 exists to end. */
  icons: {
    icon: [
      { url: './icons/migration-dev-32.png', sizes: '32x32', type: 'image/png' },
      { url: './icons/migration-dev-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: './apple-touch-icon.png',
  },
  /* No `title` here on purpose: unset, iOS falls back to the manifest's
     short_name, so the home-screen label has exactly one source. Setting it
     here would let the manifest say PREVIEW while the icon under the thumb
     did not. */
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /* `lang="ja"` here is a PRE-JS PLACEHOLDER, not the answer. The root client
     component overwrites documentElement.lang from the reader's browser on
     mount - see lib/i18n.ts. */
  return (
    <html lang="ja" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-slate-950 text-slate-300 antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
