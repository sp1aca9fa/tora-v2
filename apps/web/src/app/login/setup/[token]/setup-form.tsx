'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type SetupState, completeSetupAction } from '../actions';

/** The setup link's form: what its kind asks for, then the backup codes once. */
export function SetupForm({
  token,
  kind,
  qr,
  secret,
}: {
  token: string;
  kind: 'both' | 'password' | '2fa';
  /** The new authenticator's QR code (SVG) and key, when one is set. */
  qr: string | null;
  secret: string | null;
}) {
  const t = useTranslations('setup');
  const [state, action, pending] = useActionState<SetupState, FormData>(completeSetupAction, {});

  if (state.done)
    return (
      <div className="space-y-4 text-sm">
        <p>{t('done')}</p>
        {state.backupCodes && (
          <div className="space-y-2">
            <p className="font-medium">{t('backupTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('backupInfo')}</p>
            <ul className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-3 font-mono text-sm select-all">
              {state.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        <Button asChild className="w-full">
          <Link href="/login">{t('toLogin')}</Link>
        </Button>
      </div>
    );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {kind !== '2fa' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="password">{t('newPassword')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">{t('passwordRule')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repeat">{t('repeat')}</Label>
            <Input id="repeat" name="repeat" type="password" autoComplete="new-password" required />
          </div>
        </>
      )}
      {kind !== 'both' && (
        <div className="space-y-2">
          <Label htmlFor="current">
            {kind === 'password' ? t('currentCode') : t('currentPassword')}
          </Label>
          <Input
            id="current"
            name="current"
            type={kind === 'password' ? 'text' : 'password'}
            inputMode={kind === 'password' ? 'numeric' : undefined}
            autoComplete={kind === 'password' ? 'one-time-code' : 'current-password'}
            autoCapitalize="none"
            required
            autoFocus={kind === '2fa'}
          />
          {kind === 'password' && (
            <p className="text-xs text-muted-foreground">{t('currentCodeHint')}</p>
          )}
        </div>
      )}
      {qr && secret && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('scanTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('scanInfo')}</p>
          <div
            className="mx-auto w-48 rounded-md bg-white p-2"
            // The QR code is made on the server from the authenticator's own address.
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="text-center font-mono text-xs break-all select-all">{secret}</p>
          <Label htmlFor="code">{t('newCode')}</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className="text-center text-lg tracking-[0.3em]"
          />
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`error.${state.error}`)}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {t('save')}
      </Button>
    </form>
  );
}
