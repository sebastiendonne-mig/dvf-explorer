import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DVF Explorer · TKoidra',
  description:
    'Explorez les prix de vente immobiliers en France par adresse. Données officielles DVF de la DGFiP, disponibles de 2014 à 2025.',
  keywords:
    'DVF, prix immobilier, transaction immobilière, valeur foncière, DGFiP, prix au m², achat immobilier France',
  icons: {
    icon: '/assets/favicon.svg',
  },
  openGraph: {
    title: 'DVF Explorer · TKoidra',
    description:
      'Consultez les prix de vente immobiliers en France par adresse. Données officielles DGFiP.',
    url: 'https://dvf.tkoidra.com',
    siteName: 'DVF Explorer',
    locale: 'fr_FR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DVF Explorer · TKoidra',
    description: 'Transactions immobilières françaises par adresse. Données DVF officielles.',
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: 'https://dvf.tkoidra.com',
  },
  verification: {
    google: '-4qm4cLQ2hPYqh23O0cc_IKeevJbhrlb1-YNfZQWgtc',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="stylesheet" href="/tokens.css" />
      </head>
      <body
        className={`${inter.className} antialiased`}
        style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}
      >
        {/* Header TKoidra */}
        <header
          style={{
            height: 'var(--tk-header-height)',
            background: 'var(--tk-white)',
            borderBottom: '1px solid var(--tk-gray-200)',
            position: 'sticky',
            top: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            padding: '0 var(--tk-space-6)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              maxWidth: 'var(--tk-container-max)',
              width: '100%',
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <a href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/logo-horizontal.svg"
                height={32}
                alt="TKoidra"
                style={{ display: 'block' }}
              />
            </a>
            <a
              href="https://tkoidra.com"
              style={{
                fontSize: 'var(--tk-text-sm)',
                color: 'var(--tk-gray-600)',
                textDecoration: 'none',
              }}
            >
              ← Portfolio
            </a>
          </div>
        </header>

        {/* Contenu de la page */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>

        {/* Footer TKoidra */}
        <footer
          style={{
            background: 'var(--tk-navy)',
            padding: '2rem var(--tk-space-6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
            flexShrink: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logo-horizontal-white.svg"
            height={24}
            alt="TKoidra"
            style={{ display: 'block' }}
          />
          <div
            style={{
              display: 'flex',
              gap: '1.5rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
              fontSize: 'var(--tk-text-sm)',
            }}
          >
            <a
              href="https://tkoidra.com"
              style={{ color: 'var(--tk-cyan)', textDecoration: 'none' }}
            >
              Portfolio
            </a>
            <a
              href="https://www.linkedin.com/in/sebastiendonne"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--tk-cyan)', textDecoration: 'none' }}
            >
              LinkedIn
            </a>
            <Link href="/mentions-legales" style={{ color: 'var(--tk-cyan)', textDecoration: 'none' }}>
              Mentions légales
            </Link>
          </div>
          <p
            style={{
              fontSize: 'var(--tk-text-xs)',
              color: 'rgba(255,255,255,0.4)',
              textAlign: 'center',
            }}
          >
            © {new Date().getFullYear()} TKoidra · Données DVF · DGFiP · 2014–2025 · Décalage ~6 mois
          </p>
        </footer>

        <Analytics />
      </body>
    </html>
  );
}
