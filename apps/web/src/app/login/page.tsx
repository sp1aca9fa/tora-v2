import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth/guard';
import { safeNextPath } from '@/lib/auth/session';
import { LoginShell } from './login-shell';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('login'))('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  if (await currentSession()) redirect(next);
  return <LoginShell next={next} step="password" />;
}
