import { SPACE_COUNT, hexCenter, hexShade } from "../engine/board";
import { type GameState, KING, type Move, colorOf, inCheck, kingSpace, typeOf } from "../engine/rules";

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 40;
/**
 * As in a printed diagram: black pieces are solid glyphs, white ones outline glyphs over a
 * solid paper-coloured cut-out. U+FE0E keeps them from turning into emoji.
 */
const SOLID = ["", "♟", "♞", "♝", "♜", "♛", "♚"].map((g) => g && g + "︎");
const OUTLINE = ["", "♙", "♘", "♗", "♖", "♕", "♔"].map((g) => g && g + "︎");

/** A halftone screen of dots, as a riso print shades things. */
const screen = (id: string, cls: string, r: number, pitch = 6) =>
  `<pattern id="${id}" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">` +
  `<circle class="${cls}" cx="${pitch / 2}" cy="${pitch / 2}" r="${r}"/></pattern>`;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const hexPoints = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

/** The SVG board: hexes, highlights, and pieces that slide between spaces. */
export class BoardView {
  readonly svg: SVGSVGElement;
  private readonly hexes: SVGGElement[] = [];
  private readonly pieceLayer: SVGGElement;
  private readonly arrowLayer: SVGGElement;
  private readonly flipper: SVGGElement;
  private readonly center: [number, number];
  private pieces = new Map<number, SVGGElement>();
  /** called with the space number when someone clicks a space */
  onSpace: ((space: number) => void) | null = null;

  constructor(container: HTMLElement) {
    const centers = Array.from({ length: SPACE_COUNT + 1 }, (_, s) => (s ? hexCenter(s, SIZE) : [0, 0]));
    const xs = centers.slice(1).map((c) => c[0]!);
    const ys = centers.slice(1).map((c) => c[1]!);
    const pad = SIZE * 1.15;
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + 2 * pad, h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    this.svg = el("svg", { viewBox: `${minX} ${minY} ${w} ${h}`, class: "board", role: "img", "aria-label": "Starchess board" });

    const defs = el("defs");
    defs.innerHTML =
      screen("ht-1", "ht", 1.15) +
      screen("ht-2", "ht", 2) +
      screen("ht-pink", "ht-pink", 2.1, 5) +
      `<marker id="arrow-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto">
        <path class="arrow-head" d="M0 0L10 5L0 10z"/></marker>`;
    this.svg.append(defs);
    this.center = hexCenter(19, SIZE);
    this.flipper = el("g");
    this.svg.append(this.flipper);

    const hexLayer = el("g", { class: "hexes" });
    const points = hexPoints(SIZE * 0.97);
    for (let s = 1; s <= SPACE_COUNT; s++) {
      const [x, y] = centers[s]!;
      const g = el("g", { class: `hex shade-${hexShade(s)}`, transform: `translate(${x} ${y})`, "data-space": s });
      g.append(el("polygon", { points, class: "tile" }));
      g.append(el("polygon", { points: hexPoints(SIZE * 0.97), class: "mark" }));
      const label = el("text", { class: "space-id", x: 0, y: SIZE * 0.68 });
      label.textContent = String(s);
      g.append(label);
      g.append(el("circle", { class: "dot", r: SIZE * 0.2 }));
      g.addEventListener("click", () => this.onSpace?.(s));
      hexLayer.append(g);
      this.hexes[s] = g;
    }
    this.flipper.append(hexLayer);
    this.arrowLayer = el("g", { class: "arrows" });
    this.flipper.append(this.arrowLayer);
    this.pieceLayer = el("g", { class: "pieces" });
    this.flipper.append(this.pieceLayer);
    container.append(this.svg);
  }

  private makePiece(p: number, space: number): SVGGElement {
    const g = el("g", { class: `piece ${colorOf(p) ? "black" : "white"}` });
    g.append(el("text", { class: "body", x: 0, y: 0 }), el("text", { class: "line", x: 0, y: 0 }));
    this.drawGlyph(g, p);
    this.place(g, space);
    this.pieceLayer.append(g);
    return g;
  }

  private place(g: SVGGElement, space: number) {
    const [x, y] = hexCenter(space, SIZE);
    g.style.transform = `translate(${x}px, ${y}px)`;
  }

  private setPiece(g: SVGGElement, p: number) {
    if (g.dataset.piece === String(p)) return;
    g.dataset.piece = String(p);
    g.classList.toggle("black", !!colorOf(p));
    g.classList.toggle("white", !colorOf(p));
    this.drawGlyph(g, p);
  }

  private drawGlyph(g: SVGGElement, p: number) {
    g.dataset.piece = String(p);
    g.querySelector(".body")!.textContent = SOLID[typeOf(p)]!;
    g.querySelector(".line")!.textContent = OUTLINE[typeOf(p)]!;
  }

  /** Ink the last move in as an arrow, stopping short of the pieces' centres. */
  private drawArrow(last?: Move) {
    this.arrowLayer.replaceChildren();
    if (!last) return;
    const [x1, y1] = hexCenter(last.from, SIZE);
    const [x2, y2] = hexCenter(last.to, SIZE);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
    const start = SIZE * 0.42, end = SIZE * 0.55;
    this.arrowLayer.append(
      el("line", {
        class: "arrow",
        x1: x1 + ux * start,
        y1: y1 + uy * start,
        x2: x2 - ux * end,
        y2: y2 - uy * end,
        pathLength: 1,
        "marker-end": "url(#arrow-head)"
      })
    );
  }

  private remove(g: SVGGElement) {
    g.classList.add("gone");
    setTimeout(() => g.remove(), 400);
  }

  /**
   * Show `g`. With `last`, the moved piece slides over (unless `slide` is off, when `g` is
   * already after `last`, e.g. after a takeback); on an empty board the pieces drop in.
   */
  render(g: GameState, last?: Move, slide = true) {
    const fresh = this.pieces.size === 0;
    if (last && slide) {
      const mover = this.pieces.get(last.from);
      const victim = this.pieces.get(last.to);
      if (victim && victim !== mover) this.remove(victim);
      if (mover) {
        this.pieces.delete(last.from);
        this.pieces.set(last.to, mover);
        // the mover stays on top while it travels. Re-inserting it drops its style, so read
        // the old position back before moving it, or there's nothing to transition from
        this.pieceLayer.append(mover);
        void getComputedStyle(mover).transform;
        this.place(mover, last.to);
      }
    }
    // then make sure every space matches the game, whatever happened before
    for (let s = 1; s <= SPACE_COUNT; s++) {
      const p = g.cells[s]!;
      const shown = this.pieces.get(s);
      if (!p && shown) {
        this.remove(shown);
        this.pieces.delete(s);
      } else if (p && !shown) this.pieces.set(s, this.makePiece(p, s));
      else if (p && shown) this.setPiece(shown, p);
    }
    if (fresh) {
      // back rows first, then the pawns, white and black together
      const dropping = [...this.pieces.values()];
      dropping.forEach((piece) => {
        piece.classList.add("dropping");
        piece.style.transitionDelay = `${(typeOf(Number(piece.dataset.piece)) === 1 ? 300 : 0) + Math.random() * 200}ms`;
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => dropping.forEach((piece) => piece.classList.remove("dropping")))
      );
      setTimeout(() => dropping.forEach((piece) => (piece.style.transitionDelay = "")), 1200);
    }

    this.drawArrow(last);
    const checked = inCheck(g.cells, g.turn) ? kingSpace(g.cells, g.turn) : 0;
    for (let s = 1; s <= SPACE_COUNT; s++) {
      const h = this.hexes[s]!;
      h.classList.toggle("last-from", !!last && last.from === s);
      h.classList.toggle("last-to", !!last && last.to === s);
      h.classList.toggle("check", s === checked);
    }
    for (const [s, piece] of this.pieces) piece.classList.toggle("in-check", s === checked && typeOf(g.cells[s]!) === KING);
  }

  /** Mark a picked-up piece and where it can go. */
  select(from: number, targets: readonly number[] = []) {
    for (let s = 1; s <= SPACE_COUNT; s++) {
      const h = this.hexes[s]!;
      h.classList.toggle("selected", s === from);
      h.classList.toggle("target", targets.includes(s));
      h.classList.toggle("capture", targets.includes(s) && this.pieces.has(s));
    }
  }

  /** Spaces the player can click to pick up a piece; empty when it isn't their turn. */
  setMovable(spaces: readonly number[]) {
    this.svg.classList.toggle("interactive", spaces.length > 0);
    for (let s = 1; s <= SPACE_COUNT; s++) this.hexes[s]!.classList.toggle("movable", spaces.includes(s));
  }

  /** Turn the board round, so black sits at the bottom. */
  setFlipped(flipped: boolean) {
    const [x, y] = this.center;
    this.flipper.setAttribute("transform", flipped ? `rotate(180 ${x} ${y})` : "");
    this.svg.classList.toggle("flipped", flipped);
  }

  /** Forget every piece (a new game starts without sliding pieces around). */
  clear() {
    for (const p of this.pieces.values()) p.remove();
    this.pieces.clear();
    this.arrowLayer.replaceChildren();
  }
}
