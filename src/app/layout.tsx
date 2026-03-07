import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { InstallPrompt } from "@/components/InstallPrompt";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PageViewTracker from "@/components/PageViewTracker";
import ClickTracker from "@/components/ClickTracker";
import ChatWidget from "@/components/ChatWidget";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export const metadata: Metadata = {
  title: "PB Operations Suite",
  description: "Pipeline management dashboard for Photon Brothers",
  manifest: "/manifest.json?v=20260225",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PB Ops",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: "/icons/icon-192.png?v=20260225",
    apple: "/icons/apple-touch-icon.png?v=20260225",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme by reading localStorage before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('pb-theme');var v=(t==='light'||t==='sunset')?t:'dark';document.documentElement.classList.add(v);var c={dark:'#0a0a0f',light:'#fafaf8',sunset:'#fdf6e3'};var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',c[v])}catch(e){document.documentElement.classList.add('dark')}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <ImpersonationBanner />
          <Suspense fallback={null}>
            <PageViewTracker />
          </Suspense>
          <ClickTracker />
          {children}
          <ChatWidget />
        </Providers>
        <ServiceWorkerRegistration />
        <InstallPrompt />
        <Analytics />
      </body>
    </html>
  );
}
