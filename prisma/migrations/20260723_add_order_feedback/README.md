# Migration: 20260723_add_order_feedback

Creates `OrderFeedback` for one-time post-purchase feedback invitations
(unique on `order_id`, public link via `uuid`).

Apply manually if shadow DB is unavailable:

```bash
npx prisma db execute --file prisma/migrations/20260723_add_order_feedback/migration.sql
npx prisma generate
```
