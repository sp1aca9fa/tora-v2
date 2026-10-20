'use client';

import type { AccountSetupKind } from '@tora/db';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CopyButton } from '../commands/copy-button';
import {
  type AccountTaskState,
  cancelSetupAction,
  createAccountAction,
  requestCollectAction,
  revokeDeviceAdminAction,
  setDisabledAction,
  setupLinkAction,
} from './actions';

/** A setup link just made: shown once, to be sent to its person. */
function LinkShown({ link, expiresAt }: { link: string; expiresAt?: string }) {
  const t = useTranslations('accounts');
  const format = useFormatter();
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">{t('linkReady')}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs select-all">
          {link}
        </code>
        <CopyButton text={link} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t('linkInfo', {
          until: expiresAt
            ? format.dateTime(new Date(expiresAt), { dateStyle: 'medium', timeStyle: 'short' })
            : '-',
        })}
      </p>
    </div>
  );
}

/** The admin's authenticator code, asked before a risky task, then the task. */
function WithCode({
  label,
  run,
  onDone,
  variant = 'outline',
}: {
  label: string;
  run: (code: string) => Promise<AccountTaskState>;
  onDone?: (state: AccountTaskState) => void;
  variant?: 'outline' | 'destructive' | 'default';
}) {
  const t = useTranslations('accounts');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form
      className={cn('flex flex-wrap items-center gap-2', pending && 'opacity-60')}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const state = await run(code);
          if (state.error) return setError(t(`error.${state.error}`));
          setOpen(false);
          setCode('');
          onDone?.(state);
        });
      }}
    >
      <Input
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={t('yourCode')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="h-8 w-36"
      />
      <Button type="submit" size="sm" variant={variant} disabled={pending || code.length < 6}>
        {label}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t('cancel')}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function CreateAccountForm() {
  const t = useTranslations('accounts');
  const [username, setUsername] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [made, setMade] = useState<AccountTaskState | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="h-8 w-48"
          autoCapitalize="none"
        />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={asAdmin} onChange={(e) => setAsAdmin(e.target.checked)} />
          {t('asAdmin')}
        </label>
        <WithCode
          label={t('create')}
          variant="default"
          run={(code) => createAccountAction({ username, admin: asAdmin, code })}
          onDone={(state) => {
            setMade(state);
            setUsername('');
            setAsAdmin(false);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('usernameRule')}</p>
      {made?.link && <LinkShown link={made.link} expiresAt={made.expiresAt} />}
    </div>
  );
}

/** A person's links and switch, each asking the admin's code. */
export function AccountTasks({
  userId,
  self,
  disabled,
  setUp,
}: {
  userId: string;
  self: boolean;
  disabled: boolean;
  /** The account has a password and authenticator (else only a full setup link). */
  setUp: boolean;
}) {
  const t = useTranslations('accounts');
  const [made, setMade] = useState<AccountTaskState | null>(null);
  const kinds: AccountSetupKind[] = setUp ? ['password', '2fa', 'both'] : ['both'];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!disabled &&
          kinds.map((kind) => (
            <WithCode
              key={kind}
              label={t(setUp ? `kind.${kind}` : 'kind.again')}
              run={(code) => setupLinkAction({ userId, kind, code })}
              onDone={setMade}
            />
          ))}
        {!self && (
          <WithCode
            label={disabled ? t('enable') : t('disable')}
            variant={disabled ? 'outline' : 'destructive'}
            run={(code) => setDisabledAction({ userId, disabled: !disabled, code })}
          />
        )}
      </div>
      {made?.link && <LinkShown link={made.link} expiresAt={made.expiresAt} />}
    </div>
  );
}

/** A plain "are you sure" task (no code): signing devices out, stopping a link. */
export function ConfirmButton({
  label,
  confirm,
  task,
}: {
  label: string;
  confirm: string;
  task:
    | { kind: 'revoke'; userId: string; deviceId: string | 'all' }
    | { kind: 'cancelSetup'; userId: string }
    | { kind: 'collect' };
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirm)) return;
        start(async () => {
          if (task.kind === 'revoke') await revokeDeviceAdminAction(task.userId, task.deviceId);
          else if (task.kind === 'cancelSetup') await cancelSetupAction(task.userId);
          else await requestCollectAction();
        });
      }}
    >
      {label}
    </Button>
  );
}
