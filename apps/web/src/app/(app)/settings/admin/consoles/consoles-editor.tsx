'use client';

import { categorySearchUrl } from '@tora/core';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type ConsoleForm,
  addSuggestedConsolesAction,
  deleteConsoleAction,
  saveConsoleAction,
} from './actions';

export interface ConsoleView {
  key: string;
  names: Record<string, string>;
  aliases: string[];
  categories: Record<string, string>;
  boxedAllowed: boolean;
  sort: number;
  /** Items whose platform or rules name it. */
  used: number;
}

type Source = { key: string; label: string };

const blank = (): ConsoleForm => ({
  key: '',
  names: {},
  aliases: '',
  categories: {},
  boxedAllowed: false,
  sort: '',
});

const formOf = (c: ConsoleView): ConsoleForm => ({
  key: c.key,
  names: { ...c.names },
  aliases: c.aliases.join(', '),
  categories: { ...c.categories },
  boxedAllowed: c.boxedAllowed,
  sort: String(c.sort),
});

/** A "test" link opening the marketplace's search for the category (when its plug-in declares one). */
function TestLink({
  urls,
  source,
  category,
}: {
  urls: Record<string, string>;
  source: Source;
  category: string | undefined;
}) {
  const t = useTranslations('consoles');
  const href = category ? categorySearchUrl(urls, source.key, category) : null;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={t('testTitle', { source: source.label, category: category! })}
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {t('test')}
      <ExternalLink className="size-3" />
    </a>
  );
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** The fields of a console: the add form beside the table, or a row's edit in place. */
function ConsoleFields({
  form,
  set,
  sources,
  languages,
  urls,
  isNew,
  wide,
}: {
  form: ConsoleForm;
  set: (patch: Partial<ConsoleForm>) => void;
  sources: Source[];
  languages: string[];
  urls: Record<string, string>;
  /** Adding: the key can be typed (it cannot change later). */
  isNew: boolean;
  /** In a table row: fields in columns. */
  wide?: boolean;
}) {
  const t = useTranslations('consoles');
  return (
    <div className={cn('grid gap-3', wide && 'md:grid-cols-2 xl:grid-cols-4')}>
      {isNew && (
        <Field
          label={
            <>
              {t('key')}{' '}
              <span className="font-normal text-muted-foreground">({t('required')})</span>
            </>
          }
          hint={t('keyInfo')}
        >
          <Input
            value={form.key}
            onChange={(e) => set({ key: e.target.value })}
            placeholder="console-a"
            className="h-9 font-mono"
            required
          />
        </Field>
      )}
      {languages.map((lang) => (
        <Field key={lang} label={`${t('names')} (${lang})`}>
          <Input
            lang={lang}
            value={form.names[lang] ?? ''}
            onChange={(e) => set({ names: { ...form.names, [lang]: e.target.value } })}
            className="h-9"
          />
        </Field>
      ))}
      <Field label={t('aliases')} hint={t('aliasesInfo')}>
        <Input
          value={form.aliases}
          onChange={(e) => set({ aliases: e.target.value })}
          className="h-9"
        />
      </Field>
      {sources.map((s, i) => (
        <Field
          key={s.key}
          label={t('categoryAt', { source: s.label })}
          hint={i === 0 ? t('categoriesInfo') : undefined}
          className="min-w-0"
        >
          <div className="flex items-center gap-2">
            <Input
              inputMode="numeric"
              value={form.categories[s.key] ?? ''}
              onChange={(e) => set({ categories: { ...form.categories, [s.key]: e.target.value } })}
              className="h-9 tabular-nums"
            />
            <TestLink urls={urls} source={s} category={form.categories[s.key]?.trim()} />
          </div>
        </Field>
      ))}
      <Field label={t('sort')} hint={t('sortInfo')}>
        <Input
          type="number"
          min={0}
          max={9999}
          value={form.sort}
          onChange={(e) => set({ sort: e.target.value })}
          className="h-9 w-28"
        />
      </Field>
      <label className={cn('flex items-start gap-2', wide && 'md:col-span-2 xl:col-span-4')}>
        <input
          type="checkbox"
          checked={form.boxedAllowed}
          onChange={(e) => set({ boxedAllowed: e.target.checked })}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>{t('boxedAllowed')}</span>
      </label>
    </div>
  );
}

/**
 * The console table (admins). Phones: a card per console, the add form under them. From tablet widths
 * a table; from laptop widths the add form sits beside it at a fixed width. A row's edit opens in
 * place.
 */
export function ConsolesEditor({
  rows,
  sources,
  languages,
  suggested,
  categoryUrls,
}: {
  rows: ConsoleView[];
  /** Marketplaces that can have a software category per console. */
  sources: Source[];
  languages: string[];
  /** Suggested consoles not added yet. */
  suggested: number;
  /** Search address templates per marketplace for the "test" links. */
  categoryUrls: Record<string, string>;
}) {
  const t = useTranslations('consoles');
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ConsoleForm>(blank);
  const [form, setForm] = useState<ConsoleForm>(blank);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const setAdd = (patch: Partial<ConsoleForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setMessage(null);
  };
  const setEdit = (patch: Partial<ConsoleForm>) => {
    setEditForm((f) => ({ ...f, ...patch }));
    setMessage(null);
  };
  const edit = (c: ConsoleView | null) => {
    setEditing(c?.key ?? null);
    setEditForm(c ? formOf(c) : blank());
    setMessage(null);
  };
  const save = (data: ConsoleForm, key: string | null) =>
    startTransition(async () => {
      const result = await saveConsoleAction(data, key);
      if (!result) return;
      if ('error' in result) {
        setMessage({ ok: false, text: t(`error.${result.error}`) });
        return;
      }
      setMessage({ ok: true, text: t('saved', { key: result.saved }) });
      if (key === null) setForm(blank());
      else edit(null);
    });
  const remove = (c: ConsoleView) => {
    if (c.used > 0) {
      setMessage({ ok: false, text: t('usedNoDelete', { key: c.key, count: c.used }) });
      return;
    }
    if (!window.confirm(t('confirmDelete', { key: c.key }))) return;
    startTransition(async () => {
      const result = await deleteConsoleAction(c.key);
      if (!result) {
        setMessage({ ok: true, text: t('deleted', { key: c.key }) });
        if (editing === c.key) edit(null);
      } else if (result.error === 'used') {
        setMessage({
          ok: false,
          text: t('inUse', { key: c.key, rules: result.rules, products: result.products }),
        });
      } else setMessage({ ok: false, text: t('error.missing') });
    });
  };
  const addSuggested = () =>
    startTransition(async () => {
      const result = await addSuggestedConsolesAction();
      if (result) setMessage({ ok: true, text: t('suggestedAdded', { count: result.added }) });
    });

  const nameOf = (c: ConsoleView) =>
    languages
      .map((l) => c.names[l])
      .filter(Boolean)
      .join(' / ');
  const boxed = (c: ConsoleView) => (c.boxedAllowed ? t('yes') : t('no'));
  const category = (c: ConsoleView, s: Source) =>
    c.categories[s.key] ? (
      <span className="inline-flex items-baseline gap-2">
        <span className="tabular-nums">{c.categories[s.key]}</span>
        <TestLink urls={categoryUrls} source={s} category={c.categories[s.key]} />
      </span>
    ) : (
      <span className="text-muted-foreground">{t('noFilter')}</span>
    );
  const iconButton = 'rounded p-2 text-muted-foreground hover:bg-accent md:p-1';
  const buttons = (c: ConsoleView) => (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        className={cn(iconButton, 'hover:text-foreground')}
        aria-label={t('edit', { key: c.key })}
        title={t('edit', { key: c.key })}
        onClick={() => edit(c)}
      >
        <Pencil className="size-4" />
      </button>
      <button
        type="button"
        className={cn(iconButton, 'hover:text-destructive')}
        aria-label={t('delete', { key: c.key })}
        title={t('delete', { key: c.key })}
        onClick={() => remove(c)}
        disabled={pending}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
  const editFormOf = (c: ConsoleView, wide: boolean) => (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save(editForm, c.key);
      }}
    >
      <p className="font-medium">{t('edit', { key: c.key })}</p>
      <ConsoleFields
        form={editForm}
        set={setEdit}
        sources={sources}
        languages={languages}
        urls={categoryUrls}
        isNew={false}
        wide={wide}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => edit(null)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
  const columns = 6 + sources.length;

  return (
    <div
      className={cn(
        'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]',
        pending && 'opacity-60',
      )}
    >
      <div className="min-w-0 space-y-3">
        {suggested > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
            <span>{t('suggestedInfo', { count: suggested })}</span>
            <Button size="sm" variant="outline" onClick={addSuggested} disabled={pending}>
              {t('addSuggested')}
            </Button>
          </div>
        )}
        {message && (
          <p
            role="status"
            className={cn('text-sm', message.ok ? 'text-muted-foreground' : 'text-destructive')}
          >
            {message.text}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            {/* Phones: a card per console. */}
            <ul className="space-y-2 md:hidden">
              {rows.map((c) => (
                <li key={c.key} className="rounded-md border bg-card p-3 text-sm">
                  {editing === c.key ? (
                    editFormOf(c, false)
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p>
                          <span className="font-medium">{nameOf(c)}</span>{' '}
                          <span className="font-mono text-xs text-muted-foreground">{c.key}</span>
                        </p>
                        {c.aliases.length > 0 && (
                          <p className="text-muted-foreground">{c.aliases.join(', ')}</p>
                        )}
                        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {sources.map((s) => (
                            <div key={s.key} className="flex gap-1">
                              <dt className="text-muted-foreground">{s.label}</dt>
                              <dd>{category(c, s)}</dd>
                            </div>
                          ))}
                          <div className="flex gap-1">
                            <dt className="text-muted-foreground">{t('boxed')}</dt>
                            <dd>{boxed(c)}</dd>
                          </div>
                          <div className="flex gap-1">
                            <dt className="text-muted-foreground">{t('used')}</dt>
                            <dd>{t('usedCount', { count: c.used })}</dd>
                          </div>
                        </dl>
                      </div>
                      {buttons(c)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {/* Wider screens: a table. */}
            <div className="hidden overflow-x-auto rounded-md border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">{t('key')}</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">{t('names')}</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">{t('aliases')}</th>
                    {sources.map((s) => (
                      <th key={s.key} className="px-3 py-2 font-medium whitespace-nowrap">
                        {s.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium whitespace-nowrap">{t('boxed')}</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">{t('used')}</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">{t('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) =>
                    editing === c.key ? (
                      <tr key={c.key} className="border-t bg-accent/30">
                        <td colSpan={columns} className="px-3 py-3">
                          {editFormOf(c, true)}
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.key} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{c.key}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{nameOf(c)}</td>
                        <td className="min-w-[12rem] px-3 py-2 text-muted-foreground">
                          {c.aliases.join(', ')}
                        </td>
                        {sources.map((s) => (
                          <td key={s.key} className="px-3 py-2 whitespace-nowrap">
                            {category(c, s)}
                          </td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap">{boxed(c)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {t('usedCount', { count: c.used })}
                        </td>
                        <td className="px-3 py-2">{buttons(c)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <form
        className="space-y-3 self-start rounded-md border p-4 text-sm lg:sticky lg:top-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(form, null);
        }}
      >
        <div className="space-y-0.5">
          <h2 className="font-medium">{t('addTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('requiredNote')}</p>
        </div>
        <ConsoleFields
          form={form}
          set={setAdd}
          sources={sources}
          languages={languages}
          urls={categoryUrls}
          isNew
        />
        <Button type="submit" size="sm" disabled={pending || !form.key.trim()}>
          {t('add')}
        </Button>
      </form>
    </div>
  );
}
