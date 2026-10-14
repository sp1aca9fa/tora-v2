import type { HoldingEvent } from '@tora/db';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getMoney } from '@/lib/money-server';

const MONEY_EVENTS = new Set(['acquired', 'split', 'grading_submitted', 'sold']);

type Payload = Record<string, unknown>;

/** Holding history, newest first, one readable line per event. */
export async function EventList({ events }: { events: HoldingEvent[] }) {
  const money = await getMoney();
  const t = await getTranslations();
  const format = await getFormatter();
  const label = (group: string, key: unknown) =>
    typeof key === 'string' && t.has(`${group}.${key}`) ? t(`${group}.${key}`) : String(key ?? '');

  function summary(e: HoldingEvent): React.ReactNode {
    const p = (e.payload ?? {}) as Payload;
    switch (e.type) {
      case 'acquired':
        return t('events.acquiredSummary', {
          qty: Number(p.quantity ?? 0),
          cost: money(e.amountBase ?? 0),
        });
      case 'split':
        return p.role === 'source' ? (
          <>
            {t('events.splitSource', {
              qty: Number(p.quantityMoved),
              cost: money(Number(p.costMovedBase)),
            })}{' '}
            <Link className="underline" href={`/holdings/${String(p.toHoldingId)}`}>
              {t('events.viewLot')}
            </Link>
          </>
        ) : (
          <>
            {t('events.splitTarget', { qty: Number(p.quantity) })}{' '}
            <Link className="underline" href={`/holdings/${String(p.fromHoldingId)}`}>
              {t('events.viewLot')}
            </Link>
          </>
        );
      case 'opened':
        return label('packaging', (p.after as Payload | undefined)?.packagingState);
      case 'grading_submitted':
        return t('events.gradingSubmittedSummary', {
          grader: String(p.grader),
          fee: money(e.amountBase ?? 0),
        });
      case 'grading_returned': {
        const after = (p.after ?? {}) as Payload;
        return t('events.gradingReturnedSummary', {
          grader: String(after.grader),
          grade: String(after.grade),
        });
      }
      case 'condition_changed': {
        const after = (p.after ?? {}) as Payload;
        return [
          after.condition && label('condition', after.condition),
          after.packagingState && label('packaging', after.packagingState),
          after.rawGrade && `Raw ${String(after.rawGrade)}`,
        ]
          .filter(Boolean)
          .join(' · ');
      }
      case 'sold':
        return t('events.soldSummary', {
          qty: Number(p.quantity ?? 1),
          price: money(e.amountBase ?? 0),
          fees: money(e.feesBase ?? 0),
          platform: String(p.platform ?? '-'),
        });
      case 'note':
        if (p.kind === 'edit') {
          const changed = Object.keys((p.changes ?? {}) as Payload).map((f) => label('fields', f));
          return t('events.editSummary', { fields: changed.join(', ') });
        }
        return String(p.text ?? '');
    }
  }

  const title = (e: HoldingEvent) => {
    const p = (e.payload ?? {}) as Payload;
    return e.type === 'note' && p.kind === 'edit' ? t('events.edit') : t(`events.${e.type}`);
  };

  return (
    <ol className="space-y-3">
      {events.toReversed().map((e) => (
        <li key={e.id} className="relative border-l-2 pl-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm font-medium">{title(e)}</span>
            <time dateTime={e.occurredAt} className="text-xs text-muted-foreground">
              {format.dateTime(new Date(e.occurredAt), { dateStyle: 'medium' })}
            </time>
          </div>
          <p
            className={
              // Events that state a price or cost hide it with the other amounts.
              MONEY_EVENTS.has(e.type)
                ? 'amount text-sm whitespace-pre-line text-muted-foreground'
                : 'text-sm whitespace-pre-line text-muted-foreground'
            }
          >
            {summary(e)}
          </p>
        </li>
      ))}
    </ol>
  );
}
