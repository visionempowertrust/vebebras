const languages = { en: 'English', kn: 'ಕನ್ನಡ', hi: 'हिन्दी' };
const choiceTypes = new Set(['radio', 'checkbox']);

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function makeOption() {
  return { id: crypto.randomUUID(), label: { en: '' } };
}

function makeQuestion() {
  return {
    id: crypto.randomUUID(), type: 'radio', prompt: { en: '' }, required: true,
    points: 1, options: [makeOption(), makeOption()], correct: [],
  };
}

function makeQuiz() {
  return {
    title: { en: '' }, description: { en: '' }, language: 'none', duration_minutes: 20,
    status: 'draft', questions: [],
  };
}

export function renderEditor({ quiz, save, onCancel, t }) {
  const state = structuredClone(quiz ?? makeQuiz());
  const heading = state.id ? t('Edit test', 'ಪರೀಕ್ಷೆಯನ್ನು ಸಂಪಾದಿಸಿ', 'परीक्षा संपादित करें') : t('Create a test', 'ಪರೀಕ್ಷೆಯನ್ನು ರಚಿಸಿ', 'परीक्षा बनाएँ');
  const controls = element('fieldset', { class: 'editor-controls stack' });
  const errors = element('div', { class: 'error', tabindex: '-1', hidden: true });
  const status = element('p', { class: 'muted', role: 'status' });
  const form = element('form', { class: 'stack', novalidate: true, onsubmit: submit }, errors, controls, status);
  const editor = element('div', { class: 'stack quiz-editor' },
    element('div', { class: 'page-head' },
      element('h1', { tabindex: '-1' }, heading),
      element('p', { class: 'muted' }, t('Set the details, add questions, and choose when the test goes live.', 'ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ, ಪ್ರಶ್ನೆಗಳನ್ನು ಸೇರಿಸಿ ಮತ್ತು ಪರೀಕ್ಷೆಯನ್ನು ಯಾವಾಗ ಪ್ರಕಟಿಸಬೇಕೆಂದು ಆಯ್ಕೆಮಾಡಿ.', 'विवरण भरें, प्रश्न जोड़ें और तय करें कि परीक्षा कब प्रकाशित होगी।')),
    ), form,
  );
  let sending = false;
  editor.snapshot = () => structuredClone(state);

  const translations = () => state.language === 'none' ? ['en'] : ['en', state.language];
  const numbered = (prefix, number) => `${prefix} ${new Intl.NumberFormat(document.documentElement.lang).format(number)}`;
  const questionLabel = index => numbered(t('Question', 'ಪ್ರಶ್ನೆ', 'प्रश्न'), index + 1);
  const optionLabel = index => numbered(t('Option', 'ಆಯ್ಕೆ', 'विकल्प'), index + 1);

  function button(text, onClick, options = {}) {
    return element('button', { class: 'button secondary', type: 'button', onclick: onClick, ...options }, text);
  }

  function field(label, control, hint = '') {
    const hintId = `${control.id}-hint`;
    if (hint) control.setAttribute('aria-describedby', hintId);
    return element('div', { class: 'field' }, element('label', { for: control.id }, label), control,
      hint ? element('p', { id: hintId, class: 'muted field-hint' }, hint) : null,
    );
  }

  function textControl(id, value, update, { multiline = false, max, lang, required, rows } = {}) {
    const control = element(multiline ? 'textarea' : 'input', {
      id, maxlength: max, lang, required, rows,
      oninput: event => {
        update(event.currentTarget.value);
        clearControlError(event.currentTarget);
      },
    });
    control.value = value ?? '';
    return control;
  }

  function numberControl(id, value, update, { min, max, step = 1 }) {
    const control = element('input', { id, type: 'number', min, max, step, required: true, oninput: event => {
      update(event.currentTarget.value);
      clearControlError(event.currentTarget);
    } });
    control.value = value;
    return control;
  }

  function select(id, entries, value, update) {
    const control = element('select', { id, onchange: event => update(event.currentTarget.value) },
      entries.map(([key, label]) => element('option', { value: key }, label)));
    control.value = value;
    return control;
  }

  function localizedFields(prefix, label, values, options) {
    return translations().map(lang => field(
      element('span', {}, `${label} (`, element('span', { lang }, languages[lang]), ')'),
      textControl(`${prefix}-${lang}`, values[lang], value => { values[lang] = value; }, {
        ...options, lang, required: lang === 'en' && options.required,
      }),
    ));
  }

  function clearControlError(control) {
    control.removeAttribute('aria-invalid');
    const inlineId = `${control.id}-error`;
    document.getElementById(inlineId)?.remove();
    const otherIds = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== inlineId);
    if (otherIds.length) control.setAttribute('aria-describedby', otherIds.join(' '));
    else control.removeAttribute('aria-describedby');
  }

  function clearErrors() {
    errors.hidden = true;
    errors.replaceChildren();
    controls.querySelectorAll('[aria-invalid]').forEach(clearControlError);
  }

  function focusControl(id) {
    const target = document.getElementById(id);
    if (target) target.focus();
  }

  function draw(focusId, announcement) {
    clearErrors();
    controls.replaceChildren(
      element('section', { class: 'panel stack', 'aria-labelledby': 'quiz-details' },
        element('h2', { id: 'quiz-details' }, t('Test details', 'ಪರೀಕ್ಷೆಯ ವಿವರಗಳು', 'परीक्षा का विवरण')),
        field(t('Additional language', 'ಹೆಚ್ಚುವರಿ ಭಾಷೆ', 'अतिरिक्त भाषा'), select('quiz-language', [
          ['none', t('English only', 'ಇಂಗ್ಲಿಷ್ ಮಾತ್ರ', 'केवल अंग्रेज़ी')], ['kn', t('Kannada', 'ಕನ್ನಡ', 'कन्नड़')], ['hi', t('Hindi', 'ಹಿಂದಿ', 'हिन्दी')],
        ], state.language, value => { state.language = value; draw('quiz-language'); }),
        t('Optional translations fall back to English when left blank.', 'ಅನುವಾದ ನೀಡದಿದ್ದರೆ ಇಂಗ್ಲಿಷ್ ಪಠ್ಯ ಕಾಣಿಸುತ್ತದೆ.', 'अनुवाद खाली छोड़ने पर अंग्रेज़ी दिखाई देगी।')),
        ...localizedFields('quiz-title', t('Test title', 'ಪರೀಕ್ಷೆಯ ಶೀರ್ಷಿಕೆ', 'परीक्षा का शीर्षक'), state.title, { max: 160, required: true }),
        ...localizedFields('quiz-description', t('Description', 'ವಿವರಣೆ', 'विवरण'), state.description, { max: 4000, multiline: true, rows: 3 }),
        element('div', { class: 'fields' },
          field(t('Time limit in minutes', 'ಸಮಯ ಮಿತಿ (ನಿಮಿಷಗಳಲ್ಲಿ)', 'समय सीमा (मिनटों में)'),
            numberControl('quiz-duration', state.duration_minutes, value => { state.duration_minutes = value; }, { min: 1, max: 600 }),
            t('Test takers can choose extra time or turn off the time limit before starting.', 'ಪರೀಕ್ಷಾರ್ಥಿಗಳು ಪ್ರಾರಂಭಿಸುವ ಮೊದಲು ಹೆಚ್ಚುವರಿ ಸಮಯವನ್ನು ಆಯ್ಕೆಮಾಡಬಹುದು ಅಥವಾ ಸಮಯ ಮಿತಿಯನ್ನು ತೆಗೆದುಹಾಕಬಹುದು.', 'परीक्षार्थी शुरू करने से पहले अतिरिक्त समय चुन सकते हैं या समय सीमा हटा सकते हैं।')),
          field(t('Status', 'ಸ್ಥಿತಿ', 'स्थिति'), select('quiz-status', [
            ['draft', t('Draft', 'ಕರಡು', 'मसौदा')], ['live', t('Live', 'ಪ್ರಕಟಿಸಲಾಗಿದೆ', 'प्रकाशित')], ['closed', t('Closed', 'ಮುಚ್ಚಲಾಗಿದೆ', 'बंद')],
          ], state.status, value => {
            state.status = value;
            draw('quiz-status');
          }), t('Only live tests accept new attempts.', 'ಪ್ರಕಟಿತ ಪರೀಕ್ಷೆಗಳಿಗೆ ಮಾತ್ರ ಹೊಸ ಪ್ರಯತ್ನಗಳನ್ನು ಸ್ವೀಕರಿಸಲಾಗುತ್ತದೆ.', 'केवल प्रकाशित परीक्षाओं में नए प्रयास लिए जाते हैं।')),
        ),
      ),
      element('section', { class: 'stack', 'aria-labelledby': 'quiz-questions' },
        element('h2', { id: 'quiz-questions' }, t('Questions', 'ಪ್ರಶ್ನೆಗಳು', 'प्रश्न')),
        state.questions.length ? state.questions.map(renderQuestion) : element('p', { class: 'muted' },
          t('Add a question to get started.', 'ಪ್ರಾರಂಭಿಸಲು ಒಂದು ಪ್ರಶ್ನೆಯನ್ನು ಸೇರಿಸಿ.', 'शुरू करने के लिए एक प्रश्न जोड़ें।')),
        element('div', { class: 'row' }, button(t('Add question', 'ಪ್ರಶ್ನೆಯನ್ನು ಸೇರಿಸಿ', 'प्रश्न जोड़ें'), () => {
          const question = makeQuestion();
          state.questions.push(question);
          draw(`${question.id}-prompt-en`, t('Question added.', 'ಪ್ರಶ್ನೆಯನ್ನು ಸೇರಿಸಲಾಗಿದೆ.', 'प्रश्न जोड़ा गया।'));
        }, { id: 'quiz-add-question', disabled: state.questions.length >= 100 })),
      ),
      element('div', { class: 'row' },
        element('button', { type: 'submit', class: 'button primary' }, state.status === 'live'
          ? t('Save and publish', 'ಉಳಿಸಿ ಪ್ರಕಟಿಸಿ', 'सहेजें और प्रकाशित करें') : t('Save test', 'ಪರೀಕ್ಷೆಯನ್ನು ಉಳಿಸಿ', 'परीक्षा सहेजें')),
        button(t('Cancel', 'ರದ್ದುಮಾಡಿ', 'रद्द करें'), onCancel),
      ),
    );
    if (focusId) focusControl(focusId);
    if (announcement) status.textContent = announcement;
  }

  function renderQuestion(question, index) {
    const id = question.id;
    const label = questionLabel(index);
    const needsAnswers = state.status === 'live';
    const move = delta => {
      const target = index + delta;
      [state.questions[index], state.questions[target]] = [state.questions[target], state.questions[index]];
      draw(`${id}-heading`, t(`Moved to question ${target + 1}.`, `ಪ್ರಶ್ನೆ ${target + 1}ಕ್ಕೆ ಸರಿಸಲಾಗಿದೆ.`, `प्रश्न ${target + 1} के स्थान पर ले गए।`));
    };
    const action = (labelText, handle, options = {}) => button(labelText, handle, {
      'aria-label': `${labelText} · ${label}`, ...options,
    });
    return element('section', { class: 'panel stack question-editor', 'aria-labelledby': `${id}-heading` },
      element('h3', { id: `${id}-heading`, tabindex: '-1' }, label),
      ...localizedFields(`${id}-prompt`, t('Question text', 'ಪ್ರಶ್ನೆಯ ಪಠ್ಯ', 'प्रश्न का पाठ'), question.prompt,
        { max: 2000, multiline: true, rows: 2, required: needsAnswers }),
      element('div', { class: 'fields' },
        field(t('Question type', 'ಪ್ರಶ್ನೆಯ ವಿಧ', 'प्रश्न का प्रकार'), select(`${id}-type`, [
          ['radio', t('Multiple choice (one answer)', 'ಬಹು ಆಯ್ಕೆ (ಒಂದು ಉತ್ತರ)', 'बहुविकल्पी (एक उत्तर)')],
          ['checkbox', t('Checkboxes (multiple answers)', 'ಚೆಕ್‌ಬಾಕ್ಸ್‌ಗಳು (ಹಲವು ಉತ್ತರಗಳು)', 'चेकबॉक्स (कई उत्तर)')],
          ['short', t('Short text', 'ಚಿಕ್ಕ ಪಠ್ಯ', 'छोटा उत्तर')],
          ['long', t('Long text', 'ದೀರ್ಘ ಪಠ್ಯ', 'लंबा उत्तर')],
        ], question.type, value => {
          if (choiceTypes.has(value) !== choiceTypes.has(question.type)) {
            question.correct = [];
            question.options = choiceTypes.has(value) ? [makeOption(), makeOption()] : [];
          } else if (value === 'radio') question.correct = question.correct.slice(0, 1);
          question.type = value;
          draw(`${id}-type`);
        })),
        field(t('Points', 'ಅಂಕಗಳು', 'अंक'), numberControl(`${id}-points`, question.points,
          value => { question.points = value; }, { min: 0, max: 1000, step: '0.01' })),
      ),
      element('label', { class: 'check' }, element('input', { type: 'checkbox', checked: question.required,
        onchange: event => { question.required = event.currentTarget.checked; } }),
      t('Require an answer', 'ಉತ್ತರ ಕಡ್ಡಾಯ', 'उत्तर देना अनिवार्य')),
      choiceTypes.has(question.type) ? renderOptions(question, label) : field(
        t('Accepted answers', 'ಸ್ವೀಕರಿಸುವ ಉತ್ತರಗಳು', 'स्वीकार्य उत्तर'),
        textControl(`${id}-answers`, question.correct.join('\n'), value => { question.correct = value.split('\n'); },
          { multiline: true, rows: 3 }),
        t('Enter one accepted answer per line, including variants in each language. Leave blank to review responses manually.',
          'ಪ್ರತಿ ಸಾಲಿನಲ್ಲಿ ಒಂದು ಸ್ವೀಕಾರಾರ್ಹ ಉತ್ತರವನ್ನು ನಮೂದಿಸಿ. ಪ್ರತಿ ಭಾಷೆಯ ಉತ್ತರಗಳನ್ನು ಸೇರಿಸಬಹುದು. ಕೈಯಾರೆ ಪರಿಶೀಲಿಸಲು ಖಾಲಿ ಬಿಡಿ.',
          'हर पंक्ति में एक स्वीकार्य उत्तर लिखें। हर भाषा के विकल्प शामिल कर सकते हैं। स्वयं जाँचने के लिए खाली छोड़ें।'),
      ),
      element('div', { class: 'row' },
        action(t('Move up', 'ಮೇಲಕ್ಕೆ ಸರಿಸಿ', 'ऊपर ले जाएँ'), () => move(-1), { disabled: index === 0 }),
        action(t('Move down', 'ಕೆಳಕ್ಕೆ ಸರಿಸಿ', 'नीचे ले जाएँ'), () => move(1), { disabled: index === state.questions.length - 1 }),
        action(t('Remove question', 'ಪ್ರಶ್ನೆಯನ್ನು ತೆಗೆದುಹಾಕಿ', 'प्रश्न हटाएँ'), () => {
          state.questions.splice(index, 1);
          const neighbor = state.questions[index] ?? state.questions[index - 1];
          draw(neighbor ? `${neighbor.id}-heading` : 'quiz-add-question', t('Question removed.', 'ಪ್ರಶ್ನೆಯನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ.', 'प्रश्न हटा दिया गया।'));
        }, { class: 'button secondary danger' }),
      ),
    );
  }

  function renderOptions(question, context) {
    const fieldsetId = `${question.id}-options`;
    const radio = question.type === 'radio';
    const clearAnswer = radio ? button(t('Clear correct answer', 'ಸರಿಯಾದ ಉತ್ತರವನ್ನು ತೆರವುಗೊಳಿಸಿ', 'सही उत्तर का चयन हटाएँ'), () => {
      question.correct = [];
      draw(fieldsetId);
    }, { disabled: !question.correct.length }) : null;
    return element('fieldset', { class: 'stack option-list', id: fieldsetId, tabindex: '-1' },
      element('legend', {}, t('Options and answer key', 'ಆಯ್ಕೆಗಳು ಮತ್ತು ಸರಿಯಾದ ಉತ್ತರಗಳು', 'विकल्प और उत्तर कुंजी')),
      question.options.map((option, index) => {
        const label = optionLabel(index);
        const keyLabel = t('Correct answer', 'ಸರಿಯಾದ ಉತ್ತರ', 'सही उत्तर');
        const checked = question.correct.includes(option.id);
        return element('div', { class: 'stack option-editor' },
          ...localizedFields(`${option.id}-label`, label, option.label, { max: 500, required: state.status === 'live' }),
          element('div', { class: 'row' },
            element('label', { class: 'check' }, element('input', {
              type: radio ? 'radio' : 'checkbox', name: `${question.id}-correct`, checked,
              'aria-label': `${keyLabel} · ${label} · ${context}`,
              onchange: event => {
                if (radio) {
                  question.correct = [option.id];
                  clearAnswer.disabled = false;
                } else if (event.currentTarget.checked) question.correct.push(option.id);
                else question.correct = question.correct.filter(id => id !== option.id);
                clearControlError(document.getElementById(fieldsetId));
              },
            }), keyLabel),
            button(t('Remove option', 'ಆಯ್ಕೆಯನ್ನು ತೆಗೆದುಹಾಕಿ', 'विकल्प हटाएँ'), () => {
              question.options.splice(index, 1);
              question.correct = question.correct.filter(id => id !== option.id);
              const neighbor = question.options[index] ?? question.options[index - 1];
              draw(neighbor ? `${neighbor.id}-label-en` : `${question.id}-add-option`,
                t('Option removed.', 'ಆಯ್ಕೆಯನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ.', 'विकल्प हटा दिया गया।'));
            }, { 'aria-label': `${t('Remove option', 'ಆಯ್ಕೆಯನ್ನು ತೆಗೆದುಹಾಕಿ', 'विकल्प हटाएँ')} · ${label} · ${context}`, class: 'button secondary danger' }),
          ),
        );
      }),
      element('div', { class: 'row' }, button(t('Add option', 'ಆಯ್ಕೆಯನ್ನು ಸೇರಿಸಿ', 'विकल्प जोड़ें'), () => {
        const option = makeOption();
        question.options.push(option);
        draw(`${option.id}-label-en`, t('Option added.', 'ಆಯ್ಕೆಯನ್ನು ಸೇರಿಸಲಾಗಿದೆ.', 'विकल्प जोड़ा गया।'));
      }, { id: `${question.id}-add-option`, disabled: question.options.length >= 30 }),
      clearAnswer),
    );
  }

  function validate() {
    const issues = [];
    const add = (id, message) => issues.push({ id, message });
    const live = state.status === 'live';
    const duration = Number(state.duration_minutes);
    if (!state.title.en?.trim()) add('quiz-title-en', t('Enter the English test title.', 'ಪರೀಕ್ಷೆಯ ಇಂಗ್ಲಿಷ್ ಶೀರ್ಷಿಕೆಯನ್ನು ನಮೂದಿಸಿ.', 'परीक्षा का अंग्रेज़ी शीर्षक लिखें।'));
    if (!Number.isInteger(duration) || duration < 1 || duration > 600) add('quiz-duration',
      t('Enter a whole number from 1 to 600 for the time limit.', 'ಸಮಯ ಮಿತಿಗೆ 1 ರಿಂದ 600 ರವರೆಗಿನ ಪೂರ್ಣ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.', 'समय सीमा के लिए 1 से 600 तक की पूर्ण संख्या लिखें।'));
    if (live && !state.questions.length) add('quiz-add-question', t('Add at least one question to publish.', 'ಪ್ರಕಟಿಸಲು ಕನಿಷ್ಠ ಒಂದು ಪ್ರಶ್ನೆಯನ್ನು ಸೇರಿಸಿ.', 'प्रकाशित करने के लिए कम से कम एक प्रश्न जोड़ें।'));
    for (const [index, question] of state.questions.entries()) {
      const prefix = questionLabel(index);
      const id = question.id;
      const issue = (suffix, message) => add(`${id}-${suffix}`, `${prefix} · ${message}`);
      const points = Number(question.points);
      if (question.points === '' || !Number.isFinite(points) || points < 0 || points > 1000 || Math.abs(points * 100 - Math.round(points * 100)) > 1e-8) {
        issue('points', t('Enter points from 0 to 1000 with up to two decimal places.', 'ಎರಡು ದಶಮಾಂಶ ಸ್ಥಾನಗಳವರೆಗೆ 0 ರಿಂದ 1000 ನಡುವಿನ ಅಂಕಗಳನ್ನು ನಮೂದಿಸಿ.', '0 से 1000 के बीच अंक लिखें। दो दशमलव स्थान तक इस्तेमाल करें।'));
      }
      if (live && !question.prompt.en?.trim()) issue('prompt-en', t('Enter the English question text.', 'ಪ್ರಶ್ನೆಯ ಇಂಗ್ಲಿಷ್ ಪಠ್ಯವನ್ನು ನಮೂದಿಸಿ.', 'प्रश्न का अंग्रेज़ी पाठ लिखें।'));
      if (choiceTypes.has(question.type)) {
        if (!live) continue;
        if (question.options.length < 2) issue('add-option', t('Add at least two options.', 'ಕನಿಷ್ಠ ಎರಡು ಆಯ್ಕೆಗಳನ್ನು ಸೇರಿಸಿ.', 'कम से कम दो विकल्प जोड़ें।'));
        question.options.forEach((option, index) => {
          if (!option.label.en?.trim()) add(`${option.id}-label-en`, `${prefix} · ${optionLabel(index)} · ${t('Enter the English option text.', 'ಆಯ್ಕೆಯ ಇಂಗ್ಲಿಷ್ ಪಠ್ಯವನ್ನು ನಮೂದಿಸಿ.', 'विकल्प का अंग्रेज़ी पाठ लिखें।')}`);
        });
        if (!question.correct.length) issue('options', t('Mark at least one correct option.', 'ಕನಿಷ್ಠ ಒಂದು ಸರಿಯಾದ ಆಯ್ಕೆಯನ್ನು ಗುರುತಿಸಿ.', 'कम से कम एक सही विकल्प चिह्नित करें।'));
      } else if (question.correct.filter(answer => answer.trim()).length > 30 || question.correct.some(answer => answer.trim().length > 5000)) {
        issue('answers', t('Enter up to 30 accepted answers, each up to 5,000 characters.', 'ಗರಿಷ್ಠ 30 ಉತ್ತರಗಳನ್ನು ನಮೂದಿಸಿ. ಪ್ರತಿ ಉತ್ತರವು ಗರಿಷ್ಠ 5,000 ಅಕ್ಷರಗಳಿರಬಹುದು.', 'अधिकतम 30 स्वीकार्य उत्तर लिखें। हर उत्तर 5,000 वर्ण तक हो सकता है।'));
      }
    }
    return issues;
  }

  function showErrors(issues) {
    errors.hidden = false;
    errors.replaceChildren(element('h2', {}, t('Check the test details', 'ಪರೀಕ್ಷೆಯ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ', 'परीक्षा का विवरण जाँचें')),
      element('ul', {}, issues.map(({ id, message }) => {
        if (!id) return element('li', {}, message);
        const target = document.getElementById(id);
        if (target && !['BUTTON', 'FIELDSET'].includes(target.tagName)) {
          const inlineId = `${id}-error`;
          target.setAttribute('aria-invalid', 'true');
          target.setAttribute('aria-describedby', [target.getAttribute('aria-describedby'), inlineId].filter(Boolean).join(' '));
          target.after(element('p', { id: inlineId, class: 'error field-error' }, message));
        }
        return element('li', {}, element('a', { href: `#${id}`, onclick: event => { event.preventDefault(); focusControl(id); } }, message));
      })),
    );
    errors.focus();
  }

  function payload() {
    const result = editor.snapshot();
    result.duration_minutes = Number(result.duration_minutes);
    const trimLocalized = values => Object.fromEntries(translations().map(lang => [lang, values[lang]?.trim() ?? '']));
    result.title = trimLocalized(result.title);
    result.description = trimLocalized(result.description);
    for (const question of result.questions) {
      question.points = Number(question.points);
      question.prompt = trimLocalized(question.prompt);
      for (const option of question.options) option.label = trimLocalized(option.label);
      if (!choiceTypes.has(question.type)) question.correct = [...new Set(question.correct.map(answer => answer.trim()).filter(Boolean))];
    }
    return result;
  }

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    clearErrors();
    const issues = validate();
    if (issues.length) {
      showErrors(issues);
      return;
    }
    sending = true;
    controls.disabled = true;
    status.textContent = t('Saving test…', 'ಪರೀಕ್ಷೆಯನ್ನು ಉಳಿಸಲಾಗುತ್ತಿದೆ…', 'परीक्षा सहेजी जा रही है…');
    try {
      await save(payload());
      status.textContent = t('Test saved.', 'ಪರೀಕ್ಷೆಯನ್ನು ಉಳಿಸಲಾಗಿದೆ.', 'परीक्षा सहेज ली गई।');
    } catch (error) {
      status.textContent = '';
      const fallback = t('The test could not be saved. Try again.', 'ಪರೀಕ್ಷೆಯನ್ನು ಉಳಿಸಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.', 'परीक्षा सहेजी नहीं जा सकी। फिर कोशिश करें।');
      showErrors([{ message: error?.message || fallback }]);
    } finally {
      controls.disabled = false;
      sending = false;
    }
  }

  draw();
  return editor;
}
