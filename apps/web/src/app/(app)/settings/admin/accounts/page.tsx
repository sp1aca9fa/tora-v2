import { MAX_ACTIVE_DEVICES, listDevices, listUsers, pendingSetups } from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { AccountTasks, ConfirmButton, CreateAccountForm } from './account-forms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.accounts.title') };
}

/**
 * Account tasks in the app (S21): new accounts and resets through one-time setup links (the
 * person sets their own password and authenticator), devices, disabling. Risky tasks ask for the
 * admin's authenticator code; each lands in the activity log.
 */
export default async function AccountsPage() {
  const { db, user: me, device } = await adminOnly();
  const [users, pending, t, format] = await Promise.all([
    listUsers(db),
    pendingSetups(db),
    getTranslations('accounts'),
    getFormatter(),
  ]);
  const devices = new Map(
    await Promise.all(users.map(async (u) => [u.id, await listDevices(db, u.id)] as const)),
  );
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const badge = 'rounded-full bg-muted px-2 py-0.5 text-xs font-normal';

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t('newTitle')}</CardTitle>
          <CardDescription>{t('newInfo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateAccountForm />
        </CardContent>
      </Card>

      {users.map((u) => {
        const own = devices.get(u.id) ?? [];
        const setUp = !!u.passwordHash && !!u.totpSecretEnc;
        const link = pending.get(u.id);
        return (
          <Card key={u.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {u.username}
                {u.role === 'admin' && <span className={badge}>{t('admin')}</span>}
                {u.id === me.id && <span className={badge}>{t('you')}</span>}
                {u.disabledAt && (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-normal text-destructive">
                    {t('disabled')}
                  </span>
                )}
                {!setUp && !link && <span className={badge}>{t('notSetUp')}</span>}
              </CardTitle>
              {link && (
                <CardDescription className="flex flex-wrap items-center gap-2">
                  {t('waiting', { kind: t(`kind.${link.kind}`), until: date(link.expiresAt) })}
                  <ConfirmButton
                    label={t('stopLink')}
                    confirm={t('stopLinkConfirm', { name: u.username })}
                    task={{ kind: 'cancelSetup', userId: u.id }}
                  />
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <AccountTasks
                userId={u.id}
                self={u.id === me.id}
                disabled={!!u.disabledAt}
                setUp={setUp}
              />
              <div className="space-y-1">
                <h3 className="font-medium">
                  {t('devices', { count: own.length, max: MAX_ACTIVE_DEVICES })}
                </h3>
                {own.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('noDevices')}</p>
                ) : (
                  <ul className="divide-y">
                    {own.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                        <div>
                          <p>
                            {d.label ?? '-'}
                            {d.id === device.id && (
                              <span className={`ml-2 ${badge}`}>{t('thisDevice')}</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('deviceDates', {
                              since: date(d.createdAt),
                              seen: date(d.lastSeenAt),
                            })}
                          </p>
                        </div>
                        {d.id !== device.id && (
                          <ConfirmButton
                            label={t('signOut')}
                            confirm={t('signOutConfirm', {
                              name: u.username,
                              device: d.label ?? '-',
                            })}
                            task={{ kind: 'revoke', userId: u.id, deviceId: d.id }}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
