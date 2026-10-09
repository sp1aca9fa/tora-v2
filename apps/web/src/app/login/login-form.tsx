'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type LoginState, loginAction, verifyAction } from './actions';

export function LoginForm({ next, step }: { next: string; step: 'password' | 'code' }) {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState<LoginState, FormData>(
    step === 'password' ? loginAction : verifyAction,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {step === 'password' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="username">{t('username')}</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={state.error === 'invalid' || undefined}
            />
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="code">{t('code')}</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="none"
            required
            autoFocus
            className="text-center text-lg tracking-[0.3em]"
            aria-invalid={state.error === 'invalid' || undefined}
          />
          <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {step === 'password' ? t('continue') : t('submit')}
      </Button>
    </form>
  );
}
