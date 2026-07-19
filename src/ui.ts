// Tiny DOM helpers + router + toast.

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list") (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  el.replaceChildren();
}

let toastTimer: any;
export function toast(msg: string, ms = 1800) {
  let t = document.querySelector<HTMLElement>(".toast");
  if (!t) {
    t = h("div", { class: "toast" });
    document.body.append(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t!.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove("show"), ms);
}

// ---- hash router ----
export type RouteHandler = (params: Record<string, string>, mount: HTMLElement) => void | Promise<void>;
const routes: { re: RegExp; keys: string[]; handler: RouteHandler }[] = [];

export function route(pattern: string, handler: RouteHandler) {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ re, keys, handler });
}

export function navigate(path: string) {
  if (location.hash.slice(1) === path) renderRoute();
  else location.hash = path;
}

let mountEl: HTMLElement;
export function initRouter(mount: HTMLElement) {
  mountEl = mount;
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

async function renderRoute() {
  const path = location.hash.slice(1) || "/";
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      clear(mountEl);
      await r.handler(params, mountEl);
      window.scrollTo(0, 0);
      updateNav(path);
      return;
    }
  }
  navigate("/");
}

function updateNav(path: string) {
  document.querySelectorAll<HTMLElement>(".bottomnav button").forEach((b) => {
    const target = b.dataset.route!;
    const active = target === "/" ? path === "/" : path.startsWith(target);
    b.classList.toggle("active", active);
  });
}

export function topbar(title: string, sub?: string, back?: string): HTMLElement {
  return h(
    "div",
    { class: "topbar" },
    back ? h("button", { class: "back", onClick: () => navigate(back) }, "‹") : null,
    h("h1", {}, title, sub ? h("div", { class: "sub" }, sub) : null)
  );
}

export function screen(...nodes: (Node | null)[]): HTMLElement {
  return h("div", { class: "screen" }, ...(nodes.filter(Boolean) as Node[]));
}

// numeric input helper
export function numInput(opts: {
  value?: number | null;
  placeholder?: string;
  onInput: (v: number | null) => void;
  step?: string;
  decimal?: boolean;
}): HTMLInputElement {
  const inp = h("input", {
    type: "text",
    inputmode: opts.decimal === false ? "numeric" : "decimal",
    value: opts.value ?? "",
    placeholder: opts.placeholder ?? "",
    onInput: (e: Event) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      if (raw === "") return opts.onInput(null);
      const n = Number(raw);
      opts.onInput(Number.isNaN(n) ? null : n);
    },
  });
  return inp;
}
