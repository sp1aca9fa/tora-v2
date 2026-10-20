import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUri } from '@tora/auth';
import { getDb, loadTimeZone, offerSetupSecret, otpauthQrSvg, setupByToken } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LocaleToggle } from '@/components/locale-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authConfigFromEnv } from '@/lib/auth/session';
import { SetupForm } from './setup-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('setup'))('title') };
}

/**
 * A one-time setup link an admin made (S21): the person sets their own password and/or
 * authenticator, on their own device. Works without signing in (the token is the key).
 */
export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations();
  const config = authConfigFromEnv();
  const db = getDb();
  await loadTimeZone(db);
  let found = config ? await setupByToken(db, token) : null;

  let qr: string | null = null;
  let secret: string | null = null;
  if (found && config && found.setup.kind !== 'password') {
    // The same authenticator on every visit of the link, until it is used.
    if (!found.setup.totpSecretEnc) {
      await offerSetupSecret(
        db,
        found.setup.id,
        encryptSecret(generateTotpSecret(), config.secret),
      );
      found = await setupByToken(db, token);
    }
    if (found?.setup.totpSecretEnc) {
      secret = decryptSecret(found.setup.totpSecretEnc, config.secret);
      qr = await otpauthQrSvg(otpauthUri(secret, found.user.username));
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <LocaleToggle className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('app.name')}</p>
          <CardTitle className="text-xl">
            <h1>{t('setup.title')}</h1>
          </CardTitle>
          {found && (
            <CardDescription>
              {t(`setup.info.${found.setup.kind}`, { username: found.user.username })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {found ? (
            <SetupForm
              token={token}
              kind={found.setup.kind}
              qr={qr}
              secret={secret?.match(/.{1,4}/g)?.join(' ') ?? null}
            />
          ) : (
            <>
              <p className="text-sm">{t('setup.error.expired')}</p>
              <Link
                href="/login"
                className="block text-center text-sm text-muted-foreground underline"
              >
                {t('setup.toLogin')}
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
