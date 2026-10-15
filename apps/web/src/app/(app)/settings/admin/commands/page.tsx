import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { COMMAND_GROUPS, DOCS_URL } from './commands';
import { CopyButton } from './copy-button';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.commands.title') };
}

/**
 * The home-PC commands (S12; admins): what each does, to copy into the terminal. Nothing runs from
 * here; the guides explain each group.
 */
export default async function CommandsSettingsPage() {
  await adminOnly();
  const t = await getTranslations('commands');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('info')}</p>
      {COMMAND_GROUPS.map((group) => (
        <Card key={group.key}>
          <CardHeader>
            <CardTitle>{t(`${group.key}.title`)}</CardTitle>
            <CardDescription>
              <a
                href={`${DOCS_URL}${group.guide}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                {t('guide')}
                <ExternalLink className="size-3.5" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.commands.map((c) => (
              <div key={c.key} className="space-y-1">
                <div className="flex items-center gap-1 rounded-md bg-muted pl-3">
                  <code className="min-w-0 flex-1 overflow-x-auto py-2 text-xs whitespace-nowrap">
                    {c.command}
                  </code>
                  <CopyButton text={c.command} />
                </div>
                <p className="text-xs text-muted-foreground">{t(`${group.key}.${c.key}`)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
