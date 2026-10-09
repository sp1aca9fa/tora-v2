'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type LoginState, login } from './actions';

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {/* Lets password managers associate the saved credential with this app. */}
      <input type="hidden" name="username" value="owner" autoComplete="username" />
      <div className="space-y-2">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          aria-invalid={state.error === 'invalid' || undefined}
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(state.error)}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
