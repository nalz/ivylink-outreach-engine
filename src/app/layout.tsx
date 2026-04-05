import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'IvyLink Outreach',
  description: 'Manual Action Center',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#0c0c0d' }}>
        {children}
      </body>
    </html>
  );
}
