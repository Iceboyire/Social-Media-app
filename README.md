# Gather

## Set up Supabase

1. In the Supabase SQL editor, run each file in `supabase/migrations/` individually and in numerical order, from `01_core_schema.sql` through `10_admin_console.sql`. Wait for each file to finish successfully before running the next.
2. Create a root `.env.local` or `.env` file with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your Supabase project's API settings. Use the public anon/publishable key, never a service-role key.
3. In Supabase Authentication, set the site URL to your local app URL and allow the app's `/` and `/reset-password` URLs for email confirmation and password recovery.
4. Choose whether to require email confirmation in Supabase Authentication. If confirmation is required, new members confirm their address and sign in before continuing profile setup.

The profile photo bucket accepts JPG, PNG, and WebP images up to 5 MB. Signup crops and uploads the image after Supabase creates an authenticated session. When email confirmation is required, the photo can be added during onboarding after the member confirms their email.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`.

The authenticated app shell uses the active profile and reads friendships, conversation membership, messages, and notifications from Supabase. Apply the SQL migrations before opening it; unread message notifications are marked as read when their conversation is opened.

The shell provides a sticky search and profile navbar, desktop navigation, mobile bottom tabs, and live Supabase-backed count badges. Dark mode is saved in local storage. Shared UI components for avatars, buttons, cards, form inputs, dialogs, toasts, badges, skeletons, and empty states live in `src/components/ui/`.

Group chat support includes friend-only creation and membership, admin controls, system events, and automatic admin succession when the last admin leaves. Apply migration `09_group_chat_events.sql` to enable these database changes.

The `/admin` console verifies the active admin role through both the profile row and the server-side `is_admin()` RPC. Admin statistics, moderation actions, report resolution, and message context are protected by database policies and RPC checks. Apply `10_admin_console.sql` to enable its analytics and moderation actions.
