import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost" });

Object.assign(window, {
  Error,
  TypeError,
  DOMException,
});

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLButtonElement: window.HTMLButtonElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  EventTarget: window.EventTarget,
  MouseEvent: window.MouseEvent,
  FocusEvent: window.FocusEvent,
  PointerEvent: window.PointerEvent,
  KeyboardEvent: window.KeyboardEvent,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    setTimeout(callback, 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
