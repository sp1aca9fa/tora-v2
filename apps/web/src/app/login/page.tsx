import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LocaleToggle } from '@/components/locale-toggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SESSION_COOKIE,
  authConfigFromEnv,
  safeNextPath,
  verifySessionToken,
} from '@/lib/auth/session';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('login'))('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, authConfigFromEnv())) redirect(next);

  const t = await getTranslations();
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4">
      <LocaleToggle className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('app.name')}</p>
          <CardTitle className="text-xl">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
