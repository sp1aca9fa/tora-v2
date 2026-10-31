import { startTransition } from 'react';

/**
 * `onSubmit` for a form driven by `useActionState`. React 19 resets a `<form action>` after the
 * action returns, even with an error, which wipes what was typed; submitting by hand keeps the
 * fields. The submitter is passed so a button's name/value still reaches the action.
 */
export function submitWith(formAction: (formData: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(formData));
  };
}
