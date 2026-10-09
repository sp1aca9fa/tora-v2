import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LocaleToggle } from '@/components/locale-toggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export async function LoginShell({ next, step }: { next: string; step: 'password' | 'code' }) {
  const t = await getTranslations();
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4">
      <LocaleToggle className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('app.name')}</p>
          <CardTitle className="text-xl">
            <h1>{step === 'password' ? t('login.title') : t('login.codeTitle')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LoginForm next={next} step={step} />
          {step === 'code' && (
            <Link
              href="/login"
              className="block text-center text-sm text-muted-foreground underline"
            >
              {t('login.startOver')}
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
