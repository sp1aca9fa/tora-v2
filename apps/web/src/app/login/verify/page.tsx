import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MFA_COOKIE, authConfigFromEnv, safeNextPath, verifyMfaToken } from '@/lib/auth/session';
import { LoginShell } from '../login-shell';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('login'))('codeTitle') };
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const pending = await verifyMfaToken(
    (await cookies()).get(MFA_COOKIE)?.value,
    authConfigFromEnv(),
  );
  if (!pending) redirect('/login');
  return <LoginShell next={next} step="code" />;
}
