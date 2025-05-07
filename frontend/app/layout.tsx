// frontend/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google"; // Using Geist (sans-serif) and Geist_Mono
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  // display: 'swap', // Optional: for font display strategy
  // adjustFontFallback: false, // Optional: if you handle fallbacks manually
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // display: 'swap',
  // adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "AI Chat Assistant",
  description: "A modern chat interface for an AI assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Construct class names carefully
  const htmlClasses = `${geistSans.variable} ${geistMono.variable}`;
  const bodyClasses = `font-sans antialiased`; // Tailwind applies base styles

  return (
    <html lang="en" className={htmlClasses}>
      {/*
        Next.js automatically injects the <head> tag and its contents.
        Ensure there are NO spaces or other characters here before <body>.
      */}
      <body className={bodyClasses}>
        {children}
      </body>
    </html>
  );
}