# Vision Empower Inclusive Assessment Studio

Create and publish multilingual tests, run timed or untimed attempts, and review and export submissions. The landing page is `index.html` at the repository root and its frontend assets are in `dist/`. Supabase stores quizzes, attempts and results, authenticates test admins, and enforces deadlines and access rules.

## Set up Supabase

1. Sign in to the [project SQL editor](https://supabase.com/dashboard/project/echetmjifxcznzsrrnrz/sql/new). If this is a new database, run [the quiz schema migration](supabase/migrations/202611260001_quiz_platform.sql) once. It sets up the quiz API, storage, and automatic submission job. If quizzes are already set up, start with step 2.
2. Run [the passcode migration](supabase/migrations/202611270001_quiz_admin_passcode.sql) once. In the SQL Editor, replace the placeholder below with the password you want admins to enter. Run the same statement when you need to rotate the password.

   ```sql
   select quiz_private.set_admin_passcode('REPLACE_WITH_YOUR_SHARED_PASSWORD');
   ```

3. Open **Test Admins** and enter the password you set. Test administrators need only this password. Create a test, save it as **Live**, and check that you can submit it from **Test Takers** and download results.

Supabase stores a salted password hash and issues expiring admin sessions. Rotating the password signs out existing admin sessions. Keep the passcode and server credentials out of frontend source. Anyone with the shared password can manage tests and see results. Test takers enter a display name, and submissions count attempts because test takers do not authenticate.

## Run and deploy

Run `npx serve .` from the repository root and open the URL it prints. On GitHub Pages, choose **Settings → Pages → Deploy from a branch**, then select `main` and `/(root)`. GitHub Pages uses the root `index.html` and serves the existing frontend directly. Visitors can open a public deployment and browse tests without a ChatGPT account. Test admins use the shared password configured in Supabase.

Deploy over HTTPS. Hash-based routing works under a repository path and requires no server route rewrites.

## Quiz behavior

- Author in English, with optional Kannada or Hindi text for each quiz. The site language control changes the interface and available translated quiz text. Untranslated fields fall back to English.
- Set a standard time limit in minutes. Before entering the questions, takers can select standard time, extra time, or an untimed attempt. Timed attempts submit the answers received by Supabase by the deadline. The timer and resulting elapsed time come from the server's timestamps.
- Closing a quiz prevents new attempts. Attempts already started use a snapshot of its original questions and answer key.
- Radio and checkbox questions use answer keys. Written questions can accept exact answers with case and whitespace normalization or be left for manual review. The CSV includes responses and the auto-graded score.

## Accessibility checks before rollout

Verify with your participants' screen readers and keyboard-only navigation, including skip navigation, editing and moving questions, errors on required questions, time announcements and choosing extra time. Check at 200% and 400% zoom and review the language and formatting of the actual quiz content.
