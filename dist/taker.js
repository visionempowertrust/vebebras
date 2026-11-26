import { rpc, readStorage, writeStorage } from "./api.js";
import { h, button, link, heading, labelField } from "./ui.js";

const activeKey = "ve.quiz.active";
const jsonClone = value => JSON.parse(JSON.stringify(value));

export function timeString(seconds) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

export function createTaker({ t, localText, quizMeta, go, explainError }) {
  let record = readStorage(activeKey);
  let attempt;
  let view;
  let clock;
  let saveTimer;
  let saving;
  let timeoutRetry;
  let submitting = false;
  let dirty = record?.dirty ?? false;
  let answers = record?.answers ?? {};
  let revision = record?.revision ?? 0;
  let deadline;
  let anchorTime;
  let anchorTick;
  let timerHidden = false;
  const warnings = new Set();
  let setupValues;

  function persist() {
    writeStorage(activeKey, record && { ...record, answers, revision, dirty });
  }

  function attemptArgs() {
    return { p_attempt_id: record.id, p_token: record.token };
  }

  function answerArgs() {
    return { ...attemptArgs(), p_answers: jsonClone(answers), p_revision: revision };
  }

  function receive(state) {
    attempt = state;
    anchorTime = Date.parse(state.server_now);
    anchorTick = performance.now();
    deadline = state.deadline_at ? Date.parse(state.deadline_at) : null;
    if ((state.revision ?? 0) >= revision || state.submitted_at) {
      answers = state.answers || {};
      revision = state.revision ?? revision;
      dirty = false;
    }
    persist();
  }

  async function loadAttempt(id) {
    if (!record || record.id !== id) throw new Error("quiz_attempt_missing");
    if (attempt?.id === id) return;
    try {
      receive(await rpc("quiz_attempt", attemptArgs()));
    } catch (error) {
      if (!record.pending || !["quiz_attempt_not_found", "quiz_not_found"].includes(error.message)) throw error;
      receive(await rpc("quiz_start", record.pending));
    }
    delete record.pending;
    persist();
  }

  function refreshAttempt(id) {
    if (location.hash === `#/attempt/${id}`) go(`/attempt/${id}`, true);
  }

  function setup(quiz) {
    const title = localText(quiz.title);
    const previous = record?.quizId === quiz.id;
    const ongoing = record && record.quizId !== quiz.id && !attempt?.submitted_at;
    const name = h("input", { name: "name", autocomplete: "name", required: true, maxlength: 120 });
    const timing = h("select", { name: "timing" },
      h("option", { value: "1" }, t("Standard time", "ನಿಗದಿತ ಸಮಯ", "मानक समय")),
      h("option", { value: "2" }, t("2× time", "2 ಪಟ್ಟು ಸಮಯ", "2 गुना समय")),
      h("option", { value: "5" }, t("5× time", "5 ಪಟ್ಟು ಸಮಯ", "5 गुना समय")),
      h("option", { value: "10" }, t("10× time", "10 ಪಟ್ಟು ಸಮಯ", "10 गुना समय")),
      h("option", { value: "0" }, t("No time limit", "ಸಮಯದ ಮಿತಿ ಇಲ್ಲ", "कोई समय सीमा नहीं")));
    if (setupValues?.id === quiz.id) {
      name.value = setupValues.name;
      timing.value = setupValues.timing;
    }
    const rememberSetup = () => { setupValues = { id: quiz.id, name: name.value, timing: timing.value }; };
    const status = h("p", { class: "feedback", role: "alert" });
    const start = h("button", { type: "submit", class: "button primary" },
      t("Start test", "ಪರೀಕ್ಷೆ ಪ್ರಾರಂಭಿಸಿ", "परीक्षा शुरू करें"));
    const form = h("form", { class: "panel stack", onsubmit: async event => {
      event.preventDefault();
      name.setCustomValidity(name.value.trim() ? "" : t("Enter your name.", "ನಿಮ್ಮ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.", "अपना नाम दर्ज करें।"));
      if (!name.reportValidity()) return;
      start.disabled = true;
      status.textContent = t("Starting your test…", "ಪರೀಕ್ಷೆ ಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ…", "आपकी परीक्षा शुरू हो रही है…");
      const payload = {
        p_quiz_id: quiz.id, p_attempt_id: crypto.randomUUID(), p_token: crypto.randomUUID(),
        p_name: name.value.trim(), p_time_multiplier: Number(timing.value)
      };
      setupValues = undefined;
      record = { id: payload.p_attempt_id, token: payload.p_token, quizId: quiz.id, pending: payload };
      attempt = undefined;
      answers = {};
      dirty = false;
      revision = 0;
      timerHidden = false;
      warnings.clear();
      persist();
      try {
        receive(await rpc("quiz_start", payload));
        delete record.pending;
        persist();
        go(`/attempt/${record.id}`);
      } catch (error) {
        if (!error.status || error.status >= 500) {
          go(`/attempt/${record.id}`);
        } else {
          record = undefined;
          persist();
          status.textContent = explainError(error);
          start.disabled = false;
        }
      }
    } },
    h("h2", {}, t("Before you start", "ಪ್ರಾರಂಭಿಸುವ ಮೊದಲು", "शुरू करने से पहले")),
    h("p", { class: "muted" }, t(
      "The timer starts when you open the questions. Timed tests submit automatically when time runs out.",
      "ಪ್ರಶ್ನೆಗಳನ್ನು ತೆರೆದಾಗ ಟೈಮರ್ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ. ಸಮಯ ಮುಗಿದಾಗ ಪರೀಕ್ಷೆ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಸಲ್ಲಿಕೆಯಾಗುತ್ತದೆ.",
      "प्रश्न खुलते ही टाइमर शुरू होगा। समय पूरा होने पर परीक्षा अपने-आप जमा होगी।")),
    labelField(t("Your name", "ನಿಮ್ಮ ಹೆಸರು", "आपका नाम"), name,
      t("Your name and answers will be visible to the test admins.", "ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಉತ್ತರಗಳು ಪರೀಕ್ಷಾ ನಿರ್ವಾಹಕರಿಗೆ ಕಾಣುತ್ತವೆ.", "आपका नाम और उत्तर परीक्षा प्रशासकों को दिखेंगे।")),
    labelField(t("Timing option", "ಸಮಯದ ಆಯ್ಕೆ", "समय का विकल्प"), timing),
    h("div", { class: "row" }, start, status));
    name.addEventListener("input", () => {
      name.setCustomValidity("");
      rememberSetup();
    });
    timing.addEventListener("change", rememberSetup);

    return h("div", { class: "stack" },
      heading(h("span", { lang: title.lang }, title.text), quizMeta(quiz), link(t("All live tests", "ಎಲ್ಲ ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳು", "सभी उपलब्ध परीक्षाएँ"), "/takers")),
      localText(quiz.description).text && h("p", { class: "preserve", lang: localText(quiz.description).lang }, localText(quiz.description).text),
      previous || ongoing ? h("div", { class: "panel stack" },
        h("p", {}, t("You have a test attempt in this tab.", "ಈ ಟ್ಯಾಬ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಪರೀಕ್ಷಾ ಪ್ರಯತ್ನವಿದೆ.", "इस टैब में आपका एक परीक्षा प्रयास है।")),
        link(t("Open your attempt", "ನಿಮ್ಮ ಪ್ರಯತ್ನವನ್ನು ತೆರೆಯಿರಿ", "अपना प्रयास खोलें"), `/attempt/${record.id}`, "primary"),
        attempt?.submitted_at && button(t("Start a new attempt", "ಹೊಸ ಪ್ರಯತ್ನ ಪ್ರಾರಂಭಿಸಿ", "नया प्रयास शुरू करें"), () => {
          clearRecord();
          go(`/takers/${quiz.id}`, true);
        })) : form);
  }

  function updateAnswer(question, value) {
    answers = { ...answers, [question.id]: value };
    revision += 1;
    dirty = true;
    persist();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }

  function setSaveStatus(text) {
    if (view && view.saveStatus.textContent !== text) view.saveStatus.textContent = text;
  }

  async function save() {
    if (saving || submitting || !dirty || !attempt || attempt.submitted_at || !record) return;
    const args = answerArgs();
    const sentRecord = record;
    saving = rpc("quiz_save", args);
    try {
      const state = await saving;
      if (record !== sentRecord || submitting || attempt?.submitted_at) return;
      receive(state);
      if (state.submitted_at) refreshAttempt(state.id);
      else setSaveStatus(t("Progress saved", "ಪ್ರಗತಿ ಉಳಿಸಲಾಗಿದೆ", "प्रगति सहेजी गई"));
    } catch (error) {
      if (record !== sentRecord) return;
      setSaveStatus(t("Could not save. Retrying…", "ಉಳಿಸಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತಿದೆ…", "सहेज नहीं सके। फिर कोशिश की जा रही है…"));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 3000);
      return;
    } finally {
      saving = undefined;
    }
    if (dirty) save();
  }

  function clearRecord() {
    record = undefined;
    attempt = undefined;
    answers = {};
    revision = 0;
    dirty = false;
    clearTimeout(saveTimer);
    clearTimeout(timeoutRetry);
    persist();
  }

  function stopView() {
    clearInterval(clock);
    view = undefined;
  }

  function currentSeconds() {
    const now = anchorTime + (performance.now() - anchorTick);
    return deadline === null ? Math.max(0, Math.floor((now - Date.parse(attempt.started_at)) / 1000))
      : Math.max(0, Math.ceil((deadline - now) / 1000));
  }

  function tick() {
    if (!view || attempt.submitted_at || submitting) return;
    const seconds = currentSeconds();
    view.timer.textContent = timeString(seconds);
    if (deadline === null) return;
    for (const threshold of [60, 20]) {
      if (seconds > 0 && seconds <= threshold && !warnings.has(threshold)) {
        warnings.add(threshold);
        view.notice.textContent = threshold === 60
          ? t("One minute or less remains.", "ಒಂದು ನಿಮಿಷ ಅಥವಾ ಅದಕ್ಕಿಂತ ಕಡಿಮೆ ಸಮಯ ಉಳಿದಿದೆ.", "एक मिनट या उससे कम समय शेष है।")
          : t("20 seconds or less remain.", "20 ಸೆಕೆಂಡುಗಳು ಅಥವಾ ಅದಕ್ಕಿಂತ ಕಡಿಮೆ ಸಮಯ ಉಳಿದಿದೆ.", "20 सेकंड या उससे कम समय शेष है।");
      }
    }
    if (seconds === 0 && !timeoutRetry) finish(true);
  }

  function unanswered(question) {
    const value = answers[question.id];
    return question.required && (Array.isArray(value) ? value.length === 0 : !value?.trim());
  }

  async function finish(timedOut) {
    if (submitting || attempt?.submitted_at || !record) return;
    if (!timedOut && deadline !== null && currentSeconds() === 0) timedOut = true;
    if (!timedOut) {
      const missing = attempt.quiz.questions.find(unanswered);
      if (missing && view) {
        const field = view.fields.get(missing.id);
        field.error.textContent = t("Answer this required question.", "ಈ ಕಡ್ಡಾಯ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಿ.", "इस अनिवार्य प्रश्न का उत्तर दें।");
        field.inputs.forEach(input => input.setAttribute("aria-invalid", "true"));
        field.inputs[0]?.focus();
        return;
      }
    }
    submitting = true;
    view?.setLocked(true);
    if (timedOut && view) view.notice.textContent = t("Time is up. Submitting your saved answers.", "ಸಮಯ ಮುಗಿದಿದೆ. ಉಳಿಸಿದ ಉತ್ತರಗಳನ್ನು ಸಲ್ಲಿಸಲಾಗುತ್ತಿದೆ.", "समय समाप्त हुआ। सहेजे गए उत्तर जमा हो रहे हैं।");
    setSaveStatus(t("Submitting…", "ಸಲ್ಲಿಸಲಾಗುತ್ತಿದೆ…", "जमा हो रहा है…"));
    try {
      // A status read only finalizes an expired attempt, even if the browser clock is ahead.
      const state = timedOut ? await rpc("quiz_attempt", attemptArgs()) : await rpc("quiz_submit", answerArgs());
      receive(state);
      if (!state.submitted_at) {
        timeoutRetry = setTimeout(() => { timeoutRetry = undefined; finish(true); }, 1000);
        return;
      }
      clearTimeout(saveTimer);
      refreshAttempt(state.id);
    } catch (error) {
      setSaveStatus(explainError(error));
      if (timedOut) {
        timeoutRetry = setTimeout(() => { timeoutRetry = undefined; finish(true); }, 3500);
      } else {
        view?.setLocked(false);
        if (dirty) saveTimer = setTimeout(save, 250);
      }
    } finally {
      submitting = false;
    }
  }

  function questionField(question, index, fields) {
    const prompt = localText(question.prompt);
    const choice = ["radio", "checkbox"].includes(question.type);
    const inputs = [];
    const error = h("p", { class: "error", id: `error-${question.id}` });
    const instructions = question.type === "checkbox" && h("p", {
      class: "muted", id: `hint-${question.id}`
    }, t("Select all that apply.", "ಅನ್ವಯಿಸುವ ಎಲ್ಲ ಆಯ್ಕೆಗಳನ್ನು ಆರಿಸಿ.", "लागू होने वाले सभी विकल्प चुनें।"));
    const description = [instructions?.id, error.id].filter(Boolean).join(" ");
    const change = value => {
      error.textContent = "";
      inputs.forEach(input => input.removeAttribute("aria-invalid"));
      updateAnswer(question, value);
    };
    let controls;
    if (choice) {
      controls = question.options.map(option => {
        const wording = localText(option.label);
        const input = h("input", {
          type: question.type, name: question.id, value: option.id,
          "aria-describedby": description,
          checked: question.type === "radio" ? answers[question.id] === option.id : (answers[question.id] || []).includes(option.id),
          onchange: () => change(question.type === "radio" ? input.value : inputs.filter(item => item.checked).map(item => item.value))
        });
        inputs.push(input);
        return h("label", { class: "choice" }, input, h("span", { lang: wording.lang }, wording.text));
      });
      if (question.type === "radio" && !question.required) {
        controls.push(button(t("Clear choice", "ಆಯ್ಕೆಯನ್ನು ತೆರವುಗೊಳಿಸಿ", "चयन हटाएँ"), () => {
          inputs.forEach(input => { input.checked = false; });
          change("");
        }));
      }
    } else {
      const label = t("Your answer", "ನಿಮ್ಮ ಉತ್ತರ", "आपका उत्तर");
      const input = h(question.type === "long" ? "textarea" : "input", {
        name: question.id, maxlength: 5000, "aria-describedby": description,
        "aria-required": question.required || null, oninput: () => change(input.value)
      });
      input.value = answers[question.id] || "";
      inputs.push(input);
      controls = labelField(label, input);
    }
    fields.set(question.id, { error, inputs });
    return h("fieldset", { class: "quiz-question panel stack", "aria-describedby": description },
      h("legend", {}, `${index + 1}. `, h("span", { lang: prompt.lang }, prompt.text), " ",
        question.required
          ? h("span", { class: "badge" }, t("Required", "ಕಡ್ಡಾಯ", "अनिवार्य"))
          : h("span", { class: "badge" }, t("Optional", "ಐಚ್ಛಿಕ", "वैकल्पिक"))),
      instructions, controls, error);
  }

  function receipt() {
    const elapsed = timeString(attempt.elapsed_seconds);
    const timed = attempt.reason === "timeout";
    const title = localText(attempt.quiz.title);
    return h("div", { class: "stack" },
      heading(t("Test submitted", "ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಲಾಗಿದೆ", "परीक्षा जमा हो गई"), h("span", { lang: title.lang }, title.text)),
      h("section", { class: "panel stack", "aria-label": t("Submission receipt", "ಸಲ್ಲಿಕೆಯ ರಸೀದಿ", "जमा की रसीद") },
        h("p", {}, timed ? t("Time expired. Your saved answers were submitted.", "ಸಮಯ ಮುಗಿದಿದೆ. ಉಳಿಸಿದ ಉತ್ತರಗಳನ್ನು ಸಲ್ಲಿಸಲಾಗಿದೆ.", "समय समाप्त हुआ। सहेजे गए उत्तर जमा हो गए।")
          : t("Your answers were submitted.", "ನಿಮ್ಮ ಉತ್ತರಗಳನ್ನು ಸಲ್ಲಿಸಲಾಗಿದೆ.", "आपके उत्तर जमा हो गए।")),
        h("p", {}, t("Time taken (minutes:seconds)", "ತೆಗೆದುಕೊಂಡ ಸಮಯ (ನಿಮಿಷ:ಸೆಕೆಂಡು)", "लगा समय (मिनट:सेकंड)"), " · ", elapsed),
        button(t("Back to live tests", "ಸಕ್ರಿಯ ಪರೀಕ್ಷೆಗಳಿಗೆ ಹಿಂತಿರುಗಿ", "उपलब्ध परीक्षाओं पर लौटें"), () => {
          clearRecord();
          go("/takers");
        }, "primary")));
  }

  function renderAttempt() {
    if (attempt.submitted_at) return receipt();
    const quiz = attempt.quiz;
    const title = localText(quiz.title);
    const fields = new Map();
    const saveStatus = h("p", { class: "status", role: "status" });
    const notice = h("p", { class: "status", "aria-live": "polite", "aria-atomic": "true" });
    const timer = h("div", { class: "timer-value", role: "timer" }, timeString(currentSeconds()));
    const toggleText = () => timerHidden ? t("Show timer", "ಟೈಮರ್ ತೋರಿಸಿ", "टाइमर दिखाएँ") : t("Hide timer", "ಟೈಮರ್ ಮರೆಮಾಡಿ", "टाइमर छिपाएँ");
    const toggle = button(toggleText(), () => {
      timerHidden = !timerHidden;
      timer.hidden = timerHidden;
      toggle.textContent = toggleText();
    });
    timer.hidden = timerHidden;
    const form = h("form", { class: "attempt-main stack", novalidate: true, onsubmit: event => {
      event.preventDefault();
      finish(false);
    } }, quiz.questions.map((question, index) => questionField(question, index, fields)),
    h("div", { class: "row" },
      h("button", { class: "button primary", type: "submit" }, t("Submit test", "ಪರೀಕ್ಷೆ ಸಲ್ಲಿಸಿ", "परीक्षा जमा करें")), saveStatus));
    view = { timer, notice, saveStatus, fields, setLocked: locked => {
      form.querySelectorAll("input, textarea, button").forEach(control => { control.disabled = locked; });
    } };
    view.setLocked(submitting || Boolean(timeoutRetry));
    if (dirty) save();
    clock = setInterval(tick, 250);
    return h("div", { class: "stack" },
      heading(h("span", { lang: title.lang }, title.text),
        t("Your answers are saved as you go.", "ನೀವು ಉತ್ತರಿಸುವಾಗ ಉತ್ತರಗಳು ಉಳಿಸಲ್ಪಡುತ್ತವೆ.", "आपके उत्तर साथ-साथ सहेजे जाते हैं।")),
      h("div", { class: "attempt-layout" },
        h("aside", { class: "timer-panel panel stack" },
          h("h2", {}, deadline === null ? t("Elapsed time", "ಕಳೆದ ಸಮಯ", "बीता समय") : t("Time remaining", "ಉಳಿದ ಸಮಯ", "शेष समय")),
          timer, toggle, notice),
        form));
  }

  window.addEventListener("online", () => { if (dirty) save(); });
  window.addEventListener("pagehide", () => {
    if (record && attempt && !attempt.submitted_at && dirty) {
      rpc("quiz_save", answerArgs(), { keepalive: true }).catch(() => {});
    }
  });

  return { setup, loadAttempt, renderAttempt, stopView, currentRecord: () => record };
}
