/**
 * v1.10.0: Grain-Nest's own pop-up (window.confirm can't have a name box
 * or a "Don't ask again" tickbox), and a banner across the nest screen.
 */

export interface ModalButton {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ModalOptions {
  title: string;
  /** Paragraphs; plain text (escaped). */
  text?: string[];
  /** A bullet list under the text (piece names). */
  list?: string[];
  /** A text box, with its label and starting value. */
  input?: { label: string; value: string };
  /** A drop-down, with its label, choices and starting value. */
  select?: {
    label: string;
    options: { value: string; label: string }[];
    value: string;
  };
  /** A tickbox under the content ("Don't ask again"). */
  tickbox?: string;
  /** Left to right; the last is the default (Enter). */
  buttons: ModalButton[];
}

export interface ModalResult {
  /** The button pressed; "cancel" for Esc. */
  button: string;
  input?: string;
  select?: string;
  ticked: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shows the pop-up; resolves when a button is pressed (Esc = "cancel"). */
export function showModal(opts: ModalOptions): Promise<ModalResult> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "gn-modal-back";
    const parts: string[] = [`<div class="gn-modal" role="dialog">`];
    parts.push(`<h2>${esc(opts.title)}</h2>`);
    for (const t of opts.text || []) parts.push(`<p>${esc(t)}</p>`);
    if (opts.list && opts.list.length) {
      parts.push(
        `<ul>${opts.list.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`,
      );
    }
    if (opts.input) {
      parts.push(
        `<label class="field">${esc(opts.input.label)}<input type="text" class="gn-modal-input" value="${esc(opts.input.value)}" /></label>`,
      );
    }
    if (opts.select) {
      const o = opts.select.options
        .map(
          (c) =>
            `<option value="${esc(c.value)}"${c.value === opts.select!.value ? " selected" : ""}>${esc(c.label)}</option>`,
        )
        .join("");
      parts.push(
        `<label class="field">${esc(opts.select.label)}<select class="gn-modal-select">${o}</select></label>`,
      );
    }
    if (opts.tickbox) {
      parts.push(
        `<label class="tick"><input type="checkbox" class="gn-modal-tick" /> ${esc(opts.tickbox)}</label>`,
      );
    }
    parts.push(
      `<div class="btns">${opts.buttons
        .map(
          (b) =>
            `<button type="button" data-id="${esc(b.id)}" class="${b.primary ? "pri" : "sec"}">${esc(b.label)}</button>`,
        )
        .join("")}</div></div>`,
    );
    back.innerHTML = parts.join("");
    document.body.appendChild(back);

    const input = back.querySelector<HTMLInputElement>(".gn-modal-input");
    const select = back.querySelector<HTMLSelectElement>(".gn-modal-select");
    const tick = back.querySelector<HTMLInputElement>(".gn-modal-tick");
    const finish = (button: string): void => {
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      resolve({
        button,
        input: input ? input.value.trim() : undefined,
        select: select ? select.value : undefined,
        ticked: !!tick && tick.checked,
      });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish("cancel");
      } else if (
        e.key === "Enter" &&
        !(e.target instanceof HTMLButtonElement)
      ) {
        e.preventDefault();
        finish(opts.buttons[opts.buttons.length - 1].id);
      }
    };
    document.addEventListener("keydown", onKey, true);
    back.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((b) => {
      b.onclick = () => finish(b.dataset.id || "cancel");
    });
    if (input) {
      input.focus();
      input.select();
    } else {
      back.querySelector<HTMLButtonElement>(".btns button:last-child")?.focus();
    }
  });
}

/**
 * A banner across the top of the nest screen (one at a time). Each link
 * runs its action and closes the banner; × just closes it.
 */
export function showNestBanner(
  html: string,
  links: { label: string; run: () => void }[] = [],
  kind: "warn" | "info" = "warn",
): void {
  hideNestBanner();
  const nest = document.querySelector("#nest");
  if (!nest) return;
  const el = document.createElement("div");
  el.id = "nestbanner";
  el.className = `gn-banner ${kind}`;
  el.innerHTML = `<span class="msg">${html}</span>`;
  for (const l of links) {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = l.label;
    a.onclick = (e) => {
      e.preventDefault();
      hideNestBanner();
      l.run();
    };
    el.appendChild(a);
  }
  const x = document.createElement("a");
  x.href = "#";
  x.className = "close";
  x.title = "Close";
  x.textContent = "×";
  x.onclick = (e) => {
    e.preventDefault();
    hideNestBanner();
  };
  el.appendChild(x);
  nest.appendChild(el);
}

export function hideNestBanner(): void {
  document.querySelector("#nestbanner")?.remove();
}

/** Escapes text for showNestBanner's html. */
export const escapeHtml = esc;
