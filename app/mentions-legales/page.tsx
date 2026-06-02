import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Mentions légales — DVF Explorer',
  description: 'Mentions légales, sources des données et informations légales du site DVF Explorer.',
  robots: { index: false, follow: false },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1.5px solid #e2e8f0' }}>
        {title}
      </h2>
      <div style={{ color: '#334155', fontSize: '0.9375rem', lineHeight: 1.8 }}>
        {children}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
      <span style={{ color: '#64748b', minWidth: '160px', flexShrink: 0 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Anchor({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="ml-link"
    >
      {children}
    </a>
  );
}

export default function MentionsLegales() {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: '#2d6a4f', padding: '1.25rem 1.5rem' }}>
        <div style={{ maxWidth: '42rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" className="ml-link" style={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>
            ← DVF Explorer
          </Link>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem' }}>Mentions légales</span>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: '3rem 1.5rem 5rem' }}>
        <div style={{ maxWidth: '42rem', margin: '0 auto', background: 'white', borderRadius: '16px', padding: '2.5rem 2rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>

          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '2.25rem', letterSpacing: '-0.02em' }}>
            Mentions légales
          </h1>

          <Section title="Éditeur du site">
            <Row label="Site">dvf.tkoidra.com</Row>
            <Row label="Hébergeur">Vercel Inc., 340 Pine Street, San Francisco, CA 94104</Row>
          </Section>

          <Section title="Source des données">
            <Row label="Nom">Demandes de Valeurs Foncières (DVF)</Row>
            <Row label="Producteur">Direction Générale des Finances Publiques (DGFiP)</Row>
            <Row label="Licence">
              <Anchor href="https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf">
                Licence Ouverte / Open Licence v2.0 (Etalab)
              </Anchor>
            </Row>
            <Row label="Source">
              <Anchor href="https://files.data.gouv.fr/geo-dvf/">files.data.gouv.fr/geo-dvf</Anchor>
            </Row>
            <Row label="Années disponibles">2014 à 2025</Row>
            <Row label="Mise à jour">Annuelle, avec un décalage d&apos;environ 6 mois</Row>
            <Row label="Zones exclues">Alsace-Moselle (57, 67, 68) et Mayotte (976) — régime foncier spécifique</Row>
          </Section>

          <Section title="Limitation de responsabilité">
            <p style={{ marginBottom: '0.5rem' }}>
              Les données affichées sont issues de sources officielles mais peuvent comporter des erreurs ou des omissions. Ce site est fourni à titre informatif uniquement et ne constitue pas un conseil juridique, fiscal ou financier.
            </p>
            <p>
              Les prix affichés correspondent aux valeurs déclarées lors des mutations ; ils peuvent inclure des charges, des lots multiples ou des conditions particulières de vente.
            </p>
          </Section>

          <Section title="Intelligence artificielle">
            <Row label="Modèle">Claude (Anthropic), via l&apos;API Anthropic</Row>
            <Row label="Usage">Interprétation des requêtes et mise en forme des résultats</Row>
            <Row label="Données personnelles">Aucune donnée personnelle n&apos;est conservée</Row>
          </Section>

          <Section title="Contact">
            <Row label="Email">
              <Anchor href="mailto:sebastien@tkoidra.com">sebastien@tkoidra.com</Anchor>
            </Row>
            <Row label="LinkedIn">
              <Anchor href="https://www.linkedin.com/in/sebastiendonne">linkedin.com/in/sebastiendonne</Anchor>
            </Row>
          </Section>

        </div>
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '1.5rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Données DVF · DGFiP · Licence Ouverte v2.0</p>
      </footer>

    </div>
  );
}
