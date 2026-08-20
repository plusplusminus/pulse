import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ThemeProvider } from "@/contexts/theme-context";
import { Toaster } from "sonner";
import { PostHogProvider } from "@/components/posthog-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Pulse",
    template: "%s | Pulse",
  },
  description: "Client hub portal powered by Linear",
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }
    ],
    apple: '/apple-touch-icon.png',
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('pulse-theme') === 'dark' || (!('pulse-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark')
                } else {
                  document.documentElement.classList.remove('dark')
                }
              } catch (_) {}

              console.log(
                '%c\\n' +
                '    ██████╗ ██╗   ██╗██╗     ███████╗███████╗\\n' +
                '    ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝\\n' +
                '    ██████╔╝██║   ██║██║     ███████╗█████╗  \\n' +
                '    ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  \\n' +
                '    ██║     ╚██████╔╝███████╗███████║███████╗\\n' +
                '    ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝\\n',
                'color: #a855f7; font-size: 12px; font-family: monospace;'
              );
              console.log(
                '%c    Hey there, curious one. 👀\\n' +
                '    Like what you see under the hood?\\n\\n' +
                '    We build cool things at plusplusminus.co.za\\n',
                'color: #c084fc; font-size: 13px; font-family: monospace;'
              );
              console.log(
                '%c    ⚡ Powered by Next.js, Tailwind, Linear & good vibes',
                'color: #6b7280; font-size: 11px; font-family: monospace;'
              );
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          defaultTheme="system"
          storageKey="pulse-theme"
        >
          <AuthKitProvider>
            <PostHogProvider>
              {children}
            </PostHogProvider>
          </AuthKitProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
