import { describe, expect, it } from 'vitest';
import { withoutSources } from './tools';

describe('sources kept from AI models (query_sql)', () => {
  const ok = (sql: string) => {
    const r = withoutSources(sql, ['ebay']);
    if ('error' in r) throw new Error(r.error);
    return r.sql;
  };
  it('reads the sales table without them, keeping aliases', () => {
    expect(ok('select count(*) from price_observations where source = ?')).toBe(
      "select count(*) from (select * from price_observations where source not in ('ebay')) as price_observations where source = ?",
    );
    expect(
      ok('select o.source from price_observations o join products p on p.id = o.product_id'),
    ).toContain("from (select * from price_observations where source not in ('ebay')) as o join");
    expect(ok('select 1 from products')).toBe('select 1 from products');
  });
  it('refuses other ways to reach the table', () => {
    expect(withoutSources('select * from main.price_observations', ['ebay'])).toHaveProperty(
      'error',
    );
    expect(withoutSources('select * from "price_observations"', ['ebay'])).toHaveProperty('error');
  });
});
