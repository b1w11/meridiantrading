import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Geist } from "next/font/google";

import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { IbkrAccountBootstrap } from "@/components/IbkrAccountBootstrap";
import { PersistRehydration } from "@/components/PersistRehydration";
import { RuleEngineRunner } from "@/components/RuleEngineRunner";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Meridian",
  description: "Meridian trading workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("min-h-full", "antialiased", inter.variable, jetbrainsMono.variable, "font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AuthSessionProvider>
          <ThemeProvider>
            <IbkrAccountBootstrap />
            <PersistRehydration />
            <RuleEngineRunner />
            {children}
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
