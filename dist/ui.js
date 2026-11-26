export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) element.append(child);
  }
  return element;
}

let nextFieldId = 0;

export function labelField(label, control, hint) {
  control.id ||= `field-${++nextFieldId}`;
  const description = hint && h("span", { class: "muted", id: `${control.id}-hint` }, hint);
  if (description) control.setAttribute("aria-describedby", description.id);
  return h("div", { class: "field" }, h("label", { for: control.id }, label), control, description);
}

export function button(label, action, style = "secondary", attributes = {}) {
  return h("button", { type: "button", class: `button ${style}`, onclick: action, ...attributes }, label);
}

export function link(label, route, style = "secondary", attributes = {}) {
  return h("a", { class: `button ${style}`, href: `#${route}`, ...attributes }, label);
}

export function heading(title, intro, action) {
  return h("div", { class: "page-head" },
    h("div", {}, h("h1", { tabindex: "-1" }, title), intro && h("p", { class: "muted" }, intro)),
    action);
}
