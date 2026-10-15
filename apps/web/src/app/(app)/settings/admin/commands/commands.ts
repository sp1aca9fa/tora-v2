/**
 * The home-PC commands (S12), grouped by task, each with its guide. Texts are `commands.{group}`
 * and `commands.{group}.{key}`; the commands themselves are not translated.
 */
export interface CommandGroup {
  key: string;
  /** The guide in docs/ explaining them. */
  guide: string;
  commands: { key: string; command: string }[];
}

/** Where the guides are read (the repo's docs folder on GitHub). */
export const DOCS_URL = 'https://github.com/sp1aca9fa/tora-v2/blob/main/docs/';

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    key: 'collect',
    guide: 'running.md',
    commands: [
      { key: 'all', command: 'pnpm collect' },
      { key: 'market', command: 'pnpm collect --market <market>' },
      { key: 'source', command: 'pnpm collect --source <source>' },
      { key: 'product', command: 'pnpm collect --product <product-id>' },
      { key: 'matchOnly', command: 'pnpm collect --match-only' },
      { key: 'collectOnly', command: 'pnpm collect --collect-only' },
      { key: 'refresh', command: 'pnpm collect --refresh' },
      { key: 'valuate', command: 'pnpm valuate' },
    ],
  },
  {
    key: 'schedule',
    guide: 'running.md#the-daily-schedule',
    commands: [
      { key: 'install', command: './scripts/install-windows-task.sh' },
      { key: 'perMarket', command: 'AT=01:00 ./scripts/install-windows-task.sh --market <market>' },
      { key: 'force', command: 'FORCE=1 MAX_JITTER_SECONDS=0 ./scripts/collect-cron.sh' },
      { key: 'log', command: 'tail -f ~/.local/state/tora/collect.log' },
    ],
  },
  {
    key: 'imports',
    guide: 'running.md#imports',
    commands: [
      { key: 'uploads', command: 'pnpm import-uploads' },
      { key: 'ai', command: 'pnpm import-ai <folder> --user <username>' },
      { key: 'mail', command: 'pnpm purchases <export.mbox> --user <username>' },
      { key: 'review', command: 'pnpm review' },
    ],
  },
  {
    key: 'accounts',
    guide: 'setup.md#4-accounts',
    commands: [
      { key: 'create', command: 'pnpm user create <username>' },
      { key: 'list', command: 'pnpm user list' },
      { key: 'devices', command: 'pnpm user devices <username>' },
      { key: 'revoke', command: 'pnpm user revoke <username> <device-id|all>' },
      { key: 'password', command: 'pnpm user reset-password <username>' },
      { key: 'twoFactor', command: 'pnpm user reset-2fa <username>' },
      { key: 'disable', command: 'pnpm user disable <username>' },
      { key: 'enable', command: 'pnpm user enable <username>' },
      { key: 'demo', command: 'pnpm demo demo' },
    ],
  },
  {
    key: 'backups',
    guide: 'backups.md',
    commands: [
      { key: 'backup', command: 'pnpm backup' },
      { key: 'list', command: 'ls -lh ~/.local/share/tora/backups' },
      { key: 'restore', command: 'pnpm restore <file>' },
    ],
  },
  {
    key: 'database',
    guide: 'setup.md#2-database-turso',
    commands: [
      { key: 'migrate', command: 'pnpm db:migrate' },
      { key: 'catalogFetch', command: 'pnpm catalog:fetch' },
      { key: 'catalogSync', command: 'pnpm catalog:sync' },
      {
        key: 'mcp',
        command: 'claude mcp add tora -- pnpm --silent --dir <path-to-tora> mcp --user <username>',
      },
    ],
  },
];
