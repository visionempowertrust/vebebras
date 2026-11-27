# Vision Empower Quiz Studio

Create and publish multilingual tests, run timed or untimed attempts, and review and export submissions. The landing page is `index.html` at the repository root and its frontend assets are in `dist/`. Supabase stores quizzes, attempts and results, authenticates test admins, and enforces deadlines and access rules.

## Set up Supabase

1. Sign in to the [project SQL editor](https://supabase.com/dashboard/project/echetmjifxcznzsrrnrz/sql/new) with a project role that can run migrations. Apply `supabase/migrations/202611260001_quiz_platform.sql` once. It creates the quiz schema, API functions, access rules, and a Cron job that finalizes expired attempts even if the browser is closed. A linked Supabase CLI can also apply it with `supabase db push`.
2. In **Authentication → Users**, use **Create new user** with **Auto Confirm User** enabled to create the shared account `quiz-admin@vebebras.example`. Set its Supabase password to `QuizStudio-v1:<shared password>` (replace the placeholder with the exact password admins will type, keeping the prefix and omitting the angle brackets). The prefix accommodates Supabase's minimum password length. Use the Auth user UUID to grant this account access:

   ```sql
   insert into public.quiz_admins (user_id)
   values ('REPLACE_WITH_AUTH_USER_UUID')
   on conflict do nothing;
   ```

3. Open **Test Admins** and enter the shared password by itself. Create a test and save it as **Live** when ready. Smoke-test it from **Test Takers** and download the resulting CSV from the admin dashboard.

The browser sends the prefixed password directly to Supabase Auth. Keep the shared password, database passwords, Supabase Management API tokens and secret or service-role keys out of frontend source. The shared account can manage all quizzes and view their results once it is on the allowlist. Test takers enter a display name, and submissions count attempts because test takers do not authenticate.

## Run and deploy

Run `npx serve .` from the repository root and open the URL it prints. On GitHub Pages, choose **Settings → Pages → Deploy from a branch**, then select `main` and `/(root)`. GitHub Pages uses the root `index.html` and serves the existing frontend directly. Visitors can open a public deployment and browse tests without a ChatGPT account. Test admins sign in through Supabase.

Deploy over HTTPS. Hash-based routing works under a repository path and requires no server route rewrites.

## Quiz behavior

- Author in English, with optional Kannada or Hindi text for each quiz. The site language control changes the interface and available translated quiz text. Untranslated fields fall back to English.
- Set a standard time limit in minutes. Before entering the questions, takers can select standard time, extra time, or an untimed attempt. Timed attempts submit the answers received by Supabase by the deadline. The timer and resulting elapsed time come from the server's timestamps.
- Closing a quiz prevents new attempts. Attempts already started use a snapshot of its original questions and answer key.
- Radio and checkbox questions use answer keys. Written questions can accept exact answers with case and whitespace normalization or be left for manual review. The CSV includes responses and the auto-graded score.

## Accessibility checks before rollout

Verify with your participants' screen readers and keyboard-only navigation, including skip navigation, editing and moving questions, errors on required questions, time announcements and choosing extra time. Check at 200% and 400% zoom and review the language and formatting of the actual quiz content.
