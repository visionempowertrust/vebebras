import { h, button, link, heading, labelField } from "./ui.js";
import { rpc, signedIn, signIn, signOut, readStorage, writeStorage } from "./api.js";
import { renderEditor } from "./editor.js";
import { createTaker, timeString } from "./taker.js";

const header = document.getElementById("header");
const main = document.getElementById("main");
const footer = document.getElementById("footer");
const skip = document.getElementById("skip");
const announcement = document.getElementById("announcement");
const languages = { en: "English", kn: "ಕನ್ನಡ", hi: "हिन्दी" };
let language = Object.hasOwn(languages, readStorage("ve.quiz.language")) ? readStorage("ve.quiz.language") : "en";
let rendered = 0;
let editor;
let editorRoute;

function t(en, kn, hi) {
  return { en, kn, hi }[language] || en;
}

function localText(content) {
  if (content?.[language]) return { lang: language, text: content[language] };
  return { lang: "en", text: content?.en || "" };
}

function localized(content) {
  const value = localText(content);
  return h("span", { lang: value.lang }, value.text);
}

function say(message) {
  announcement.textContent = message;
}

function route() {
  return location.hash.slice(1) || "/";
}

function go(path, refresh = false) {
  if (route() === path) {
    if (refresh) render();
  } else {
    location.hash = path;
  }
}

function quizMeta(quiz) {
  const count = quiz.question_count ?? quiz.questions?.length ?? 0;
  const questionCount = t(count === 1 ? "1 question" : `${count} questions`, `${count} ಪ್ರಶ್ನೆಗಳು`, `${count} प्रश्न`);
  const duration = t(`${quiz.duration_minutes} min`, `${quiz.duration_minutes} ನಿಮಿಷ`, `${quiz.duration_minutes} मिनट`);
  const regional = quiz.language && quiz.language !== "none" && languages[quiz.language];
  return h("span", { class: "meta" }, questionCount, " · ", duration,
    regional && [" · ", h("span", { lang: quiz.language }, regional)]);
}

function explainError(error) {
  if (error.code === "PGRST202") return t(
    "Quiz Studio is awaiting database setup. Ask a test administrator to complete setup.",
    "ಕ್ವಿಜ್ ಸ್ಟುಡಿಯೋದ ಡೇಟಾಬೇಸ್ ಇನ್ನೂ ಸಿದ್ಧವಾಗಿಲ್ಲ. ಸೆಟಪ್ ಪೂರ್ಣಗೊಳಿಸಲು ಪರೀಕ್ಷಾ ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.",
    "क्विज़ स्टूडियो का डेटाबेस अभी तैयार नहीं है। सेटअप पूरा करने के लिए परीक्षा प्रशासक से कहें।");
  if (error.code === "42501" || error.status === 403) return t(
    "This account is not authorized to administer tests.",
    "ಈ ಖಾತೆಗೆ ಪರೀಕ್ಷೆಗಳನ್ನು ನಿರ್ವಹಿಸಲು ಅನುಮತಿ ಇಲ್ಲ.",
    "इस खाते को परीक्षाएँ प्रबंधित करने की अनुमति नहीं है।");
  if (error.code === "invalid_credentials" || /invalid login/i.test(error.message)) return t(
    "Check your email and password and try again.",
    "ನಿಮ್ಮ ಇಮೇಲ್ ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್ ಪರಿಶೀಲಿಸಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    "अपना ईमेल और पासवर्ड जाँचें और फिर कोशिश करें।");
  if (error.message === "quiz_required_answers") return t("Answer all required questions.", "ಎಲ್ಲ ಕಡ್ಡಾಯ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ.", "सभी अनिवार्य प्रश्नों के उत्तर दें।");
  if (error.message === "quiz_not_live") return t("This test is no longer open.", "ಈ ಪರೀಕ್ಷೆ ಈಗ ಲಭ್ಯವಿಲ್ಲ.", "यह परीक्षा अब उपलब्ध नहीं है।");
  if (["quiz_attempt_missing", "quiz_attempt_not_found", "quiz_not_found"].includes(error.message)) return t(
    "This item is unavailable. Open the list of tests to continue.",
    "ಇದು ಲಭ್ಯವಿಲ್ಲ. ಮುಂದುವರಿಯಲು ಪರೀಕ್ಷೆಗಳ ಪಟ್ಟಿಯನ್ನು ತೆರೆಯಿರಿ.",
    "यह उपलब्ध नहीं है। जारी रखने के लिए परीक्षाओं की सूची खोलें।");
  if (error.message === "quiz_sign_in" || error.status === 401) return t(
    "Sign in to continue.", "ಮುಂದುವರಿಯಲು ಸೈನ್ ಇನ್ ಮಾಡಿ.", "जारी रखने के लिए साइन इन करें।");
  return t("We couldn't complete that request. Please try again.",
    "ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ।",
    "अनुरोध पूरा नहीं हो सका। कृपया फिर कोशिश करें।");
}

const taker = createTaker({ t, localText, quizMeta, go, explainError });

function shell(path) {
  document.documentElement.lang = language;
  skip.textContent = t("Skip to main content", "ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ತೆರಳಿ", "मुख्य सामग्री पर जाएँ");
  const nav = [
    ["/", t("Home", "ಮುಖಪುಟ", "मुखपृष्ठ")],
    ["/admin", t("Test Admins", "ಪರೀಕ್ಷಾ ನಿರ್ವಾಹಕರು", "परीक्षा प्रशासक")],
    ["/takers", t("Test Takers", "ಪರೀಕ್ಷಾರ್ಥಿಗಳು", "परीक्षार्थी")]
  ];
  const locale = h("select", { id: "site-language", onchange: event => {
    language = event.currentTarget.value;
    writeStorage("ve.quiz.language", language);
    render({ focus: "language" });
  } }, Object.entries(languages).map(([code, name]) =>
    h("option", { value: code, lang: code, selected: language === code }, name)));
  header.replaceChildren(h("div", { class: "header-inner" },
    h("a", { class: "brand", href: "#/" },
      h("img", { class: "brand-logo", src: new URL("./vision-empower-logo.svg", import.meta.url).href,
        width: 810, height: 145, alt: "Vision Empower", lang: "en" }),
      h("strong", { class: "brand-text" }, t("Quiz Studio", "ಕ್ವಿಜ್ ಸ್ಟುಡಿಯೋ", "क्विज़ स्टूडियो"))),
    h("nav", { class: "nav-links", "aria-label": t("Main navigation", "ಮುಖ್ಯ ಸಂಚರಣೆ", "मुख्य नेविगेशन") },
      nav.map(([url, name]) => h("a", {
        href: `#${url}`,
        "aria-current": (url === "/" ? path === "/" : path.startsWith(url) || (url === "/takers" && path.startsWith("/attempt/"))) ? "page" : null
      }, name))),
    h("div", { class: "language-field" }, h("label", { for: locale.id }, t("Language", "ಭಾಷೆ", "भाषा")), locale)));
  footer.replaceChildren(h("div", { class: "footer-inner" },
    h("strong", { lang: "en" }, "Vision Empower"),
    h("span", {}, t("Quiz Studio", "ಕ್ವಿಜ್ ಸ್ಟುಡಿಯೋ", "क्विज़ स्टूडियो"))));
}

function home() {
  const admin = t("Test Admins", "ಪರೀಕ್ಷಾ ನಿರ್ವಾಹಕರು", "परीक्षा प्रशासक");
  const testers = t("Test Takers", "ಪರೀಕ್ಷಾರ್ಥಿಗಳು", "परीक्षार्थी");
  const pathway = (kind, title, description, call, url) =>
    h("article", { class: "path-card" },
      h("div", { class: "path-icon", "aria-hidden": "true" }, kind),
      h("h3", {}, title), h("p", {}, description), link(call, url));

  return h("div", { class: "home" },
    h("section", { class: "hero", "aria-labelledby": "home-title" },
      h("div", { class: "hero-copy" },
        h("p", { class: "eyebrow" }, t("VISION EMPOWER · QUIZ STUDIO", "ವಿಷನ್ ಎಂಪವರ್ · ಕ್ವಿಜ್ ಸ್ಟುಡಿಯೋ", "विज़न एम्पावर · क्विज़ स्टूडियो")),
        h("h1", { id: "home-title", tabindex: "-1" },
          t("Build a quiz.", "ರಸಪ್ರಶ್ನೆ ರಚಿಸಿ.", "क्विज़ बनाएँ।"), " ",
          h("span", { class: "hero-accent" }, t("Open it to learners.", "ಕಲಿಯುವವರಿಗೆ ತೆರೆಯಿರಿ.", "इसे शिक्षार्थियों के लिए खोलें।"))),
        h("p", { class: "hero-intro" }, t(
          "Create multilingual tests, run timed or untimed attempts, and download results in one place.",
          "ಬಹುಭಾಷಾ ಪರೀಕ್ಷೆಗಳನ್ನು ರಚಿಸಿ, ಸಮಯ ಮಿತಿಯೊಂದಿಗೆ ಅಥವಾ ಸಮಯ ಮಿತಿಯಿಲ್ಲದೆ ನಡೆಸಿ, ಫಲಿತಾಂಶಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ.",
          "बहुभाषी परीक्षाएँ बनाएँ, समय सीमा के साथ या बिना परीक्षा चलाएँ, और परिणाम डाउनलोड करें।")),
        h("div", { class: "hero-actions" },
          link(t("Find a test", "ಪರೀಕ್ಷೆ ಹುಡುಕಿ", "परीक्षा खोजें"), "/takers", "primary"),
          link(t("Manage tests", "ಪರೀಕ್ಷೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ", "परीक्षाएँ प्रबंधित करें"), "/admin"))),
      h("div", { class: "hero-art", "aria-hidden": "true" },
        h("div", { class: "orbit" }),
        h("div", { class: "motif-grid" }, ["filled", "", "coral", "", "filled", "", "filled", "", "filled"].map(style =>
          h("div", { class: `motif-cell ${style}` }))))),
    h("section", { class: "pathways", "aria-labelledby": "pathways-title" },
      h("div", { class: "section-heading" },
        h("h2", { id: "pathways-title" }, t("Choose where to start", "ಎಲ್ಲಿ ಪ್ರಾರಂಭಿಸಬೇಕೆಂದು ಆರಿಸಿ", "शुरू करने का विकल्प चुनें"))),
      h("div", { class: "path-grid" },
        pathway("+", admin, t(
          "Create and edit tests, set answer keys, publish when ready, and export submissions.",
          "ಪರೀಕ್ಷೆಗಳನ್ನು ರಚಿಸಿ ಮತ್ತು ಸಂಪಾದಿಸಿ, ಉತ್ತರದ ಕೀಗಳನ್ನು ಹೊಂದಿಸಿ, ಸಿದ್ಧವಾದಾಗ ಪ್ರಕಟಿಸಿ ಮತ್ತು ಸಲ್ಲಿಕೆಗಳನ್ನು ರಫ್ತು ಮಾಡಿ.",
          "परीक्षाएँ बनाएँ और संपादित करें, उत्तर कुंजी तय करें, तैयार होने पर प्रकाशित करें और जमा उत्तर निर्यात करें।"),
        t("Open admin dashboard", "ನಿರ್ವಾಹಕ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯಿರಿ", "प्रशासक डैशबोर्ड खोलें"), "/admin"),
        pathway("✓", testers, t(
          "Browse live tests, choose a language and timing option, and submit your answers.",
          "ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳನ್ನು ನೋಡಿ, ಭಾಷೆ ಮತ್ತು ಸಮಯದ ಆಯ್ಕೆ ಆರಿಸಿ, ನಿಮ್ಮ ಉತ್ತರಗಳನ್ನು ಸಲ್ಲಿಸಿ.",
          "उपलब्ध परीक्षाएँ देखें, भाषा और समय का विकल्प चुनें और अपने उत्तर जमा करें।"),
        t("Browse live tests", "ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳನ್ನು ನೋಡಿ", "उपलब्ध परीक्षाएँ देखें"), "/takers"))));
}

async function liveTests(id) {
  const tests = await rpc("quiz_list_live");
  if (id) {
    const quiz = tests.find(item => item.id === id);
    if (!quiz) throw new Error("quiz_not_live");
    return taker.setup(quiz);
  }
  const resume = taker.currentRecord();
  return h("div", { class: "stack" }, heading(t("Live tests", "ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳು", "उपलब्ध परीक्षाएँ"),
    t("Choose a test to see its details and timing options.", "ವಿವರಗಳು ಮತ್ತು ಸಮಯದ ಆಯ್ಕೆಗಳನ್ನು ನೋಡಲು ಪರೀಕ್ಷೆ ಆರಿಸಿ.", "विवरण और समय के विकल्प देखने के लिए परीक्षा चुनें।")),
    resume && h("div", { class: "panel row" }, link(t("Open your attempt", "ನಿಮ್ಮ ಪ್ರಯತ್ನವನ್ನು ತೆರೆಯಿರಿ", "अपना प्रयास खोलें"), `/attempt/${resume.id}`)),
    tests.length ? h("div", { class: "cards" }, tests.map(quiz =>
      h("article", { class: "panel quiz-card stack" }, h("h2", {}, localized(quiz.title)),
        quizMeta(quiz), localText(quiz.description).text && h("p", { class: "preserve" }, localized(quiz.description)),
        link(t("View test", "ಪರೀಕ್ಷೆ ನೋಡಿ", "परीक्षा देखें"), `/takers/${quiz.id}`, "primary",
          { "aria-label": `${t("View test", "ಪರೀಕ್ಷೆ ನೋಡಿ", "परीक्षा देखें")}: ${localText(quiz.title).text}` }))))
      : h("p", { class: "panel" }, t("There are no live tests right now.", "ಸದ್ಯ ಯಾವುದೇ ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳಿಲ್ಲ.", "अभी कोई परीक्षा उपलब्ध नहीं है।")));
}

function adminLink() {
  return link(t("Back to dashboard", "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ಗೆ ಹಿಂತಿರುಗಿ", "डैशबोर्ड पर लौटें"), "/admin");
}

function adminLogin() {
  const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { type: "submit", class: "button primary" }, t("Sign in", "ಸೈನ್ ಇನ್", "साइन इन करें"));
  return h("div", { class: "stack" }, heading(t("Test Admins", "ಪರೀಕ್ಷಾ ನಿರ್ವಾಹಕರು", "परीक्षा प्रशासक"),
    t("Sign in with your administrator account to manage tests and view results.", "ಪರೀಕ್ಷೆಗಳನ್ನು ನಿರ್ವಹಿಸಲು ಮತ್ತು ಫಲಿತಾಂಶಗಳನ್ನು ನೋಡಲು ನಿರ್ವಾಹಕ ಖಾತೆಯೊಂದಿಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.", "परीक्षाएँ प्रबंधित करने और परिणाम देखने के लिए अपने प्रशासक खाते से साइन इन करें।")),
  h("form", { class: "panel stack narrow", onsubmit: async event => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = "";
    try {
      await signIn(email.value.trim(), password.value);
      await render();
    } catch (problem) {
      error.textContent = explainError(problem);
      submit.disabled = false;
    }
  } }, labelField(t("Email", "ಇಮೇಲ್", "ईमेल"), email),
  labelField(t("Password", "ಪಾಸ್‌ವರ್ಡ್", "पासवर्ड"), password), submit, error));
}

const adminRpc = (name, args) => rpc(name, args, { admin: true });
const testStatus = status => ({
  draft: t("Draft", "ಕರಡು", "मसौदा"), live: t("Live", "ಸಕ್ರಿಯ", "उपलब्ध"), closed: t("Closed", "ಮುಚ್ಚಲಾಗಿದೆ", "बंद")
})[status];

function signOutButton() {
  return button(t("Sign out", "ಸೈನ್ ಔಟ್", "साइन आउट करें"), async () => {
    const logout = signOut();
    go("/admin", true);
    await logout;
  });
}

async function dashboard() {
  const tests = await adminRpc("quiz_admin_list");
  const total = tests.reduce((sum, quiz) => sum + Number(quiz.submission_count), 0);
  const live = tests.filter(quiz => quiz.status === "live").length;
  const stat = (value, label) => h("div", { class: "panel stat" }, h("strong", {}, value), h("span", {}, label));
  return h("div", { class: "stack" },
    heading(t("Test Admins", "ಪರೀಕ್ಷಾ ನಿರ್ವಾಹಕರು", "परीक्षा प्रशासक"),
      t("Build tests, control when they are live, and download submissions.",
        "ಪರೀಕ್ಷೆಗಳನ್ನು ರಚಿಸಿ, ಅವು ಯಾವಾಗ ಸಕ್ರಿಯವಾಗಿರಬೇಕು ಎಂಬುದನ್ನು ನಿಯಂತ್ರಿಸಿ ಮತ್ತು ಸಲ್ಲಿಕೆಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ.",
        "परीक्षाएँ बनाएँ, तय करें कि वे कब उपलब्ध हों, और जमा उत्तर डाउनलोड करें।"),
      h("div", { class: "row" },
        link(t("Create test", "ಪರೀಕ್ಷೆ ರಚಿಸಿ", "परीक्षा बनाएँ"), "/admin/new", "primary"), signOutButton())),
    h("div", { class: "stats" }, stat(tests.length, t("Total tests", "ಒಟ್ಟು ಪರೀಕ್ಷೆಗಳು", "कुल परीक्षाएँ")),
      stat(live, t("Live tests", "ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳು", "उपलब्ध परीक्षाएँ")),
      stat(total, t("Submitted attempts", "ಸಲ್ಲಿಸಿದ ಪ್ರಯತ್ನಗಳು", "जमा किए गए प्रयास"))),
    h("section", { class: "stack", "aria-labelledby": "your-tests" },
      h("h2", { id: "your-tests" }, t("Your tests", "ನಿಮ್ಮ ಪರೀಕ್ಷೆಗಳು", "आपकी परीक्षाएँ")),
      tests.length ? h("div", { class: "cards" }, tests.map(quiz => {
        const submissions = Number(quiz.submission_count);
        return h("article", { class: "panel quiz-card stack" },
          h("span", { class: `badge ${quiz.status}` }, testStatus(quiz.status)),
          h("h3", {}, localized(quiz.title)), quizMeta(quiz),
          h("p", {}, t(submissions === 1 ? "1 submission" : `${submissions} submissions`, `${submissions} ಸಲ್ಲಿಕೆಗಳು`, `${submissions} जमा प्रयास`)),
          h("div", { class: "row" },
            link(t("Edit", "ಸಂಪಾದಿಸಿ", "संपादित करें"), `/admin/edit/${quiz.id}`, "secondary",
              { "aria-label": `${t("Edit", "ಸಂಪಾದಿಸಿ", "संपादित करें")} ${localText(quiz.title).text}` }),
            link(t("Results", "ಫಲಿತಾಂಶಗಳು", "परिणाम"), `/admin/results/${quiz.id}`, "secondary",
              { "aria-label": `${t("Results", "ಫಲಿತಾಂಶಗಳು", "परिणाम")} · ${localText(quiz.title).text}` })));
      })) : h("p", { class: "panel" }, t("Your tests will appear here after you save them.",
        "ಪರೀಕ್ಷೆಗಳನ್ನು ಉಳಿಸಿದ ನಂತರ ಅವು ಇಲ್ಲಿ ಕಾಣುತ್ತವೆ.", "सहेजने के बाद आपकी परीक्षाएँ यहाँ दिखेंगी।"))));
}

function csvValue(value) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function downloadResults(id, labels, rows) {
  const detail = item => (item.quiz?.questions || []).map(question => {
    const answer = item.answers?.[question.id];
    const choiceText = optionId => question.options?.find(option => option.id === optionId)?.label?.en || optionId;
    return {
      id: question.id, question: question.prompt?.en,
      answer: Array.isArray(answer) ? answer.map(choiceText) : question.type === "radio" && answer ? choiceText(answer) : answer ?? ""
    };
  });
  const values = [labels, ...rows.map(item => [
    item.id, item.name, item.started_at, item.submitted_at, item.elapsed_seconds, item.reason,
    item.score, item.max_score, item.manual_count, JSON.stringify(detail(item))
  ])];
  const contents = values.map(row => row.map(csvValue).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" }));
  const anchor = h("a", { href: url, download: `quiz-${id}-results.csv` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  say(t("Results downloaded.", "ಫಲಿತಾಂಶಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಲಾಗಿದೆ.", "परिणाम डाउनलोड हो गए।"));
}

async function results(id) {
  const [quiz, rows] = await Promise.all([
    adminRpc("quiz_admin_get", { p_quiz_id: id }), adminRpc("quiz_admin_results", { p_quiz_id: id })
  ]);
  const columns = [
    t("Name", "ಹೆಸರು", "नाम"),
    t("Submitted", "ಸಲ್ಲಿಸಿದ ಸಮಯ", "जमा करने का समय"),
    t("Taken (min:sec)", "ಸಮಯ (ನಿಮಿಷ:ಸೆಕೆಂಡು)", "लगा समय (मिनट:सेकंड)"),
    t("Mode", "ಸಲ್ಲಿಕೆ ವಿಧಾನ", "जमा करने का तरीका"),
    t("Auto-graded score", "ಸ್ವಯಂ ಮೌಲ್ಯಮಾಪನ ಅಂಕ", "स्वचालित अंक"),
    t("For manual review", "ಹಸ್ತಚಾಲಿತ ಪರಿಶೀಲನೆಗೆ", "मैनुअल समीक्षा के लिए")
  ];
  const csvLabels = ["Attempt ID", "Name", "Started (UTC)", "Submitted (UTC)", "Elapsed seconds", "Submission type",
    "Auto-graded score", "Available auto-graded points", "Answers for manual review", "Responses (JSON)"];
  const formatter = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  return h("div", { class: "stack" },
    heading(t("Test results", "ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶಗಳು", "परीक्षा परिणाम"), localized(quiz.title),
      h("div", { class: "row" }, adminLink(), button(t("Download CSV", "CSV ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", "CSV डाउनलोड करें"),
        () => downloadResults(id, csvLabels, rows), "primary", { disabled: !rows.length }))),
    rows.length ? h("div", { class: "panel table-scroll", tabindex: "0", role: "region",
      "aria-label": t("Results table", "ಫಲಿತಾಂಶಗಳ ಕೋಷ್ಟಕ", "परिणाम तालिका") },
    h("table", {}, h("caption", { class: "sr-only" }, t("Submitted attempts", "ಸಲ್ಲಿಸಿದ ಪ್ರಯತ್ನಗಳು", "जमा किए गए प्रयास")),
      h("thead", {}, h("tr", {}, columns.map(label => h("th", { scope: "col" }, label)))),
      h("tbody", {}, rows.map(item => h("tr", {},
        h("th", { scope: "row" }, item.name), h("td", {}, formatter.format(new Date(item.submitted_at))),
        h("td", {}, timeString(item.elapsed_seconds)),
        h("td", {}, item.reason === "timeout" ? t("Time expired", "ಸಮಯ ಮುಗಿದಿದೆ", "समय समाप्त") : t("Submitted by taker", "ಪರೀಕ್ಷಾರ್ಥಿ ಸಲ್ಲಿಸಿದ್ದಾರೆ", "परीक्षार्थी ने जमा किया")),
        h("td", {}, `${item.score} / ${item.max_score}`), h("td", {}, item.manual_count))))))
      : h("p", { class: "panel" }, t("No submissions yet.", "ಇನ್ನೂ ಯಾವುದೇ ಸಲ್ಲಿಕೆಗಳಿಲ್ಲ.", "अभी तक कोई परीक्षा जमा नहीं हुई है।")));
}

async function adminPage(parts, snapshot, current) {
  if (!signedIn()) return adminLogin();
  if (parts.length === 1) return dashboard();
  if (parts[1] === "results" && parts[2]) return results(parts[2]);
  if (parts[1] === "new" || (parts[1] === "edit" && parts[2])) {
    if (parts[1] === "new" && !snapshot) await adminRpc("quiz_admin_list");
    const quiz = snapshot?.quiz ?? (parts[2] ? await adminRpc("quiz_admin_get", { p_quiz_id: parts[2] }) : undefined);
    const newId = snapshot?.id || quiz?.id || crypto.randomUUID();
    const component = renderEditor({ quiz, onCancel: () => go("/admin"), t, report: say,
      save: async payload => {
        try {
          await adminRpc("quiz_admin_save", { p_quiz: { ...payload, id: newId } });
        } catch (error) {
          throw new Error(explainError(error));
        }
        say(t("Test saved.", "ಪರೀಕ್ಷೆಯನ್ನು ಉಳಿಸಲಾಗಿದೆ.", "परीक्षा सहेजी गई।"));
        go("/admin");
      } });
    if (current === rendered) {
      editor = component;
      editorRoute = route();
      component.quizId = newId;
    }
    return component;
  }
  throw new Error("quiz_not_found");
}

async function render({ focus = "heading" } = {}) {
  const current = ++rendered;
  const path = route();
  const snapshot = focus === "language" && editorRoute === path && editor
    ? { quiz: editor.snapshot(), id: editor.quizId } : undefined;
  const parts = path.split("/").filter(Boolean);
  taker.stopView();
  editor = undefined;
  shell(path);
  if (focus === "language") document.getElementById("site-language").focus();
  const loading = h("p", { class: "panel status", role: "status" }, t("Loading…", "ಲೋಡ್ ಆಗುತ್ತಿದೆ…", "लोड हो रहा है…"));
  if (path !== "/") main.replaceChildren(loading);
  let content;
  try {
    if (path === "/") content = home();
    else if (parts[0] === "takers") content = await liveTests(parts[1]);
    else if (parts[0] === "admin") content = await adminPage(parts, snapshot, current);
    else if (parts[0] === "attempt" && parts[1]) {
      await taker.loadAttempt(parts[1]);
      if (current !== rendered) return;
      content = taker.renderAttempt();
    } else throw new Error("quiz_not_found");
  } catch (error) {
    const admin = parts[0] === "admin";
    content = h("div", { class: "stack" },
      heading(t("Unable to open this page", "ಈ ಪುಟವನ್ನು ತೆರೆಯಲಾಗಲಿಲ್ಲ", "यह पेज नहीं खुल सका")),
      h("div", { class: "panel stack" }, h("p", {}, explainError(error)),
        h("div", { class: "row" },
          button(t("Try again", "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ", "फिर कोशिश करें"), () => render(), "primary"),
          admin && signedIn() ? signOutButton() : link(t("Browse live tests", "ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳನ್ನು ನೋಡಿ", "उपलब्ध परीक्षाएँ देखें"), "/takers"))));
  }
  if (current !== rendered) return;
  main.replaceChildren(content);
  const title = main.querySelector("h1");
  if (title) {
    title.setAttribute("tabindex", "-1");
    if (focus === "heading") {
      title.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }
  const brand = t("Quiz Studio", "ಕ್ವಿಜ್ ಸ್ಟುಡಿಯೋ", "क्विज़ स्टूडियो");
  document.title = path === "/" ? `${brand} · Vision Empower` : `${title?.textContent || brand} · ${brand}`;
}

skip.addEventListener("click", event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener("hashchange", () => render());
render({ focus: "none" });
