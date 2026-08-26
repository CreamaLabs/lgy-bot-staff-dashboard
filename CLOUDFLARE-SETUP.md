# LGY Bot Staff Dashboard — Cloudflare setup

## Build settings

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

## Cloudflare Variables and Secrets

Add these under the Worker project’s **Settings → Variables and Secrets**.

### Plain-text variables

- `PUBLIC_BASE_URL` = `https://lgy-bot-staff-dashboard.creamaholicstudio.workers.dev`
- `DISCORD_CLIENT_ID` = the same client/application ID used by LGY Bot
- `DISCORD_GUILD_ID` = the Ligaya Street RP Discord server ID
- `DISCORD_ADMIN_ROLE_IDS` = the same comma-separated role IDs as LGY Bot’s `ADMIN_ROLE_IDS`
- `DISCORD_OWNER_USER_ID` = optional Discord user ID that should always have owner access

### Encrypted secrets

- `DISCORD_CLIENT_SECRET` = from Discord Developer Portal → LGY Bot → OAuth2
- `SESSION_SECRET` = a newly generated random password of at least 48 characters
- `BOT_SYNC_SECRET` = another newly generated random password of at least 48 characters

Never put these encrypted values in GitHub. `BOT_SYNC_SECRET` must be identical in Cloudflare and Bot-Hosting.net.

## Discord OAuth redirect

In Discord Developer Portal → LGY Bot → OAuth2 → Redirects, add:

`https://lgy-bot-staff-dashboard.creamaholicstudio.workers.dev/auth/callback`

Save the Discord application changes.
