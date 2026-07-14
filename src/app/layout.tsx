import type { Metadata, Viewport } from 'next'
import { Archivo, Fraunces, Geist_Mono, Hanken_Grotesk } from 'next/font/google'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/shell/app-shell'
import { DbGate } from '@/components/shell/db-gate'
import { DurabilityInit } from '@/components/shell/durability-init'
import { SeedOnMount } from '@/components/shell/seed-on-mount'
import { ServiceWorkerRegister } from '@/components/shell/service-worker-register'
import { ThemeProvider } from '@/components/shell/theme-provider'
import './globals.css'

// Display face (metal-cyberpunk default) — heavy industrial grotesk, set
// UPPERCASE + engraved in globals.css. The other themes keep Fraunces, which
// metal-cyberpunk overrides to --font-archivo in theme scope.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  display: 'swap',
})

// Display face for the alternate themes — warm, characterful serif (Craft Taproom voice).
const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
})

// Body face — clean humanist grotesk, friendly without being generic.
const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-hanken',
  subsets: ['latin'],
  display: 'swap',
})

// Mono — tabular numerals for vital stats, gravities, serials.
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Beer-Lab-Ware',
  description: 'Homebrewing recipe calculator tuned to the BrewTools B40 Pro',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  // Cyan — the metal-cyberpunk machine accent. theme-provider.syncThemeColor()
  // overwrites this at runtime from the active theme's computed --primary.
  themeColor: '#2ee6ff',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-theme="metal-cyberpunk"
      className={`${archivo.variable} ${fraunces.variable} ${hankenGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Apply the saved theme before paint to avoid a default→theme flash (FOUC). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: tiny trusted pre-hydration theme shim
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('brew-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})()",
          }}
        />
        <ThemeProvider>
          <ServiceWorkerRegister />
          <DurabilityInit />
          <DbGate>
            <SeedOnMount />
            <AppShell>{children}</AppShell>
          </DbGate>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
