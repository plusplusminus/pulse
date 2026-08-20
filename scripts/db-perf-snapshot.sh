#!/usr/bin/env bash
# Snapshot production Postgres performance stats via the Supabase Management API.
# Read-only. Run before/after a perf change (or weekly) and diff the output.
#
# Usage:
#   scripts/db-perf-snapshot.sh [out_dir]          # default: ./perf-snapshots/<timestamp>/
#   SUPABASE_ACCESS_TOKEN=sbp_... scripts/db-perf-snapshot.sh
#
# Token resolution: $SUPABASE_ACCESS_TOKEN, else the Supabase CLI login stored in the
# macOS keychain ("Supabase CLI" / access-token, go-keyring base64 wrapped).
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-tyfzcufaxkwwtokfpzww}"
OUT_DIR="${1:-perf-snapshots/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT_DIR"

resolve_token() {
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then echo "$SUPABASE_ACCESS_TOKEN"; return; fi
  local raw
  raw=$(security find-generic-password -s "Supabase CLI" -a access-token -w 2>/dev/null || true)
  if [ -z "$raw" ]; then
    echo "No SUPABASE_ACCESS_TOKEN and no Supabase CLI login found. Run: supabase login" >&2; exit 1
  fi
  case "$raw" in
    go-keyring-base64:*) echo "${raw#go-keyring-base64:}" | base64 -d ;;
    *) echo "$raw" ;;
  esac
}
TOKEN=$(resolve_token)

run_sql() { # $1 = name, $2 = sql
  local body
  body=$(jq -n --arg q "$2" '{query:$q}')
  curl -sf -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body" \
    > "$OUT_DIR/$1.json"
  echo "  wrote $OUT_DIR/$1.json ($(jq 'length' "$OUT_DIR/$1.json") rows)"
}

echo "Snapshotting $PROJECT_REF -> $OUT_DIR"

run_sql meta "select now() as taken_at, (select stats_reset from pg_stat_statements_info) as pss_reset,
  (select count(*) from pg_stat_activity) as connections,
  (select setting from pg_settings where name='max_connections') as max_connections,
  pg_size_pretty(pg_database_size(current_database())) as db_size"

run_sql top_by_total_time "select r.rolname, s.calls, round(s.total_exec_time::numeric/1000,1) total_s,
  round(s.mean_exec_time::numeric,1) mean_ms, round(s.max_exec_time::numeric,1) max_ms, s.rows,
  left(regexp_replace(s.query,'\s+',' ','g'),300) query
  from pg_stat_statements s join pg_roles r on r.oid=s.userid
  where r.rolname not in ('supabase_admin','postgres','supabase_auth_admin','supabase_storage_admin','pgbouncer')
  order by s.total_exec_time desc limit 40"

run_sql top_by_mean_time "select r.rolname, s.calls, round(s.total_exec_time::numeric/1000,1) total_s,
  round(s.mean_exec_time::numeric,1) mean_ms, round(s.max_exec_time::numeric,1) max_ms, s.rows,
  left(regexp_replace(s.query,'\s+',' ','g'),300) query
  from pg_stat_statements s join pg_roles r on r.oid=s.userid
  where r.rolname not in ('supabase_admin','postgres','supabase_auth_admin','supabase_storage_admin','pgbouncer')
    and s.calls >= 20
  order by s.mean_exec_time desc limit 40"

run_sql top_by_calls "select r.rolname, s.calls, round(s.total_exec_time::numeric/1000,1) total_s,
  round(s.mean_exec_time::numeric,1) mean_ms, left(regexp_replace(s.query,'\s+',' ','g'),300) query
  from pg_stat_statements s join pg_roles r on r.oid=s.userid
  where r.rolname not in ('supabase_admin','postgres','supabase_auth_admin','supabase_storage_admin','pgbouncer')
  order by s.calls desc limit 40"

run_sql tables "select relname, n_live_tup, n_dead_tup, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
  pg_size_pretty(pg_total_relation_size(relid)) total_size, last_autovacuum, last_autoanalyze
  from pg_stat_user_tables where schemaname='public' order by pg_total_relation_size(relid) desc"

run_sql indexes "select t.relname tbl, i.indexrelname idx, i.idx_scan, pg_size_pretty(pg_relation_size(i.indexrelid)) size,
  pg_get_indexdef(i.indexrelid) def
  from pg_stat_user_indexes i join pg_stat_user_tables t on t.relid=i.relid
  where i.schemaname='public' order by 1,2"

run_sql fks_without_index "select c.conrelid::regclass::text tbl, c.conname,
  (select string_agg(a.attname, ',') from unnest(c.conkey) k join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k) cols
  from pg_constraint c
  where c.contype='f' and c.connamespace='public'::regnamespace
    and not exists (select 1 from pg_index x where x.indrelid=c.conrelid and (x.indkey::int2[])[0:0] = c.conkey[1:1])"

echo "Done. Compare two snapshots with e.g.:"
echo "  diff <(jq -r '.[]|[.mean_ms,.calls,.query]|@tsv' A/top_by_mean_time.json) <(jq -r '.[]|[.mean_ms,.calls,.query]|@tsv' B/top_by_mean_time.json)"
