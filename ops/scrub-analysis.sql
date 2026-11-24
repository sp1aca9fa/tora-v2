-- Takes the data of sources kept from AI models (`noAi`: their terms forbid it) out of a fresh
-- analysis copy, before it replaces the old one (ops/copy-backups.sh, `refreshAnalysisCopy`). Scripts and direct
-- reads use that copy without the guards of the MCP `query_sql` tool, so it must not hold them. Which items
-- have a listing there stays (the source's name and the link, as `query_sql` shows them).
-- A new table or column holding a source's data belongs here too: packages/mcp/src/no-ai.test.ts
-- fails until every guarded table has its statement here.
begin;
create temp table hidden as select key from sources where json_extract(info, '$.noAi');

delete from price_observations where source in hidden;
-- After the sales: deleting them marks their days here.
delete from price_days_dirty where source in hidden;
delete from supply where source in hidden;
delete from signals where source in hidden;
delete from source_candidates where source in hidden;
delete from rankings where source in hidden;
delete from opening_cards where source in hidden;
delete from opening_sets where source in hidden;
delete from stores where source in hidden;
delete from store_posts where source in hidden;
delete from tcg_sets where source in hidden;
delete from collector_runs where source in hidden;
delete from not_item_marks where source in hidden;
delete from sale_coverage where source in hidden;
delete from sale_spans where source in hidden;
-- Daytime reads (S36 B4): a job's cursor and error come from the site.
delete from market_jobs where source in hidden;
delete from market_days where source in hidden;
delete from market_state where source in hidden;
-- A game's checks (S36): a listings check is one source's; a sales check reads every source together,
-- so its counts and note go. Why an item's rules are held may quote a source's sales.
delete from item_checks where source in hidden;
update item_checks set counts = null, note = null where source = '' and exists (select 1 from hidden);
update item_rule_state set held = null where held is not null and exists (select 1 from hidden);
-- A game wish's levels (W14) mix several sources' sales and name them per day: a row naming such a
-- source goes whole (a source marked noAi stays in it until the next nightly refresh).
delete from wish_levels
  where exists (select 1 from hidden where instr(wish_levels.series, '"' || hidden.key || '"'));

update item_sales set sales = json_set(sales,
    '$.n', json((select json_group_object(n.key, json(n.value))
      from json_each(item_sales.sales, '$.n') n where n.key not in hidden)),
    '$.groups', json((select json_group_array(json(g.value))
      from json_each(item_sales.sales, '$.groups') g
      where json_extract(g.value, '$.s') not in hidden)))
  where exists (select 1 from hidden where instr(item_sales.sales, '"' || hidden.key || '"'));

delete from bucket_values where json_extract(value, '$.valuation.source') in hidden;
update bucket_values set value = json_set(value,
    '$.last', case when json_extract(value, '$.last.source') in hidden then null
      else json(json_extract(value, '$.last')) end,
    '$.buylist', case when json_extract(value, '$.buylist.source') in hidden then null
      else json(json_extract(value, '$.buylist')) end,
    '$.sources', json((select json_group_array(json(s.value))
      from json_each(bucket_values.value, '$.sources') s
      where coalesce(json_extract(s.value, '$.source'), '') not in hidden)))
  where exists (select 1 from hidden where instr(bucket_values.value, '"' || hidden.key || '"'));

update product_sources set recent_sales = null, state = null, failure = null, title = null,
    image_url = null, last_success_at = null, details_synced_at = null, facts = null
  where source in hidden;
-- Gap and bias come from a source's prices, and another source's row may be compared against it.
-- Roles read from the copy then ignore a "disagrees" against a hidden source (none today).
update sources set quality = null
  where key in hidden or exists (select 1 from hidden h where instr(quality, '"' || h.key || '"'));

-- The self check leaves these sources out where it reads; only one marked after its numbers were
-- stored can still be here, until the next morning.
delete from app_settings
  where key = 'dataCheck' and exists (select 1 from hidden h where instr(value, '"' || h.key || '"'));

-- Saved opportunities hold each item's numbers, ask and listing counts, on the item's own source;
-- its shop price can come from any source.
update app_settings set value = json_set(value, '$.items', (select json_group_array(json(
      case when json_extract(e.value, '$.buylist.source') in hidden
        then json_set(e.value, '$.buylist', json('null')) else e.value end))
    from json_each(app_settings.value, '$.items') e
    where coalesce(json_extract(e.value, '$.source'), '') not in hidden))
  where key = 'opportunities' and exists (select 1 from hidden h where instr(value, '"' || h.key || '"'));

-- A game wish's alert memory (S36 C3) keys the copies sent by source, listing and seller with their
-- prices; a card or sealed watch's memory (zone, target) stays.
update watches set alert_state = json_remove(alert_state, '$.wish')
  where json_extract(alert_state, '$.wish') is not null and exists (select 1 from hidden);

-- Messages and logs name sources and quote their errors.
update activity set detail = '{}'
  where kind in ('collect', 'check', 'admin') and exists (select 1 from hidden);
update alert_log set text = ''
  where (kind is null or kind not in ('store', 'storeUnknown', 'feed', 'test'))
    and exists (select 1 from hidden);

drop table hidden;
commit;
-- Deleted rows must not stay readable in the file's free pages.
vacuum;
