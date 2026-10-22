import { SPACE_COUNT, hexCenter, hexShade } from "../engine/board";
import { BACK_SPACES, type GameState, KING, type Move, colorOf, inCheck, kingSpace, typeOf } from "../engine/rules";

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 40;
/** Solid glyphs for both sides (filled differently); U+FE0E keeps them from turning into emoji. */
const GLYPH = ["", "♟", "♞", "♝", "♜", "♛", "♚"].map((g) => g && g + "︎");

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
  private pieces = new Map<number, SVGGElement>();

  constructor(container: HTMLElement) {
    const centers = Array.from({ length: SPACE_COUNT + 1 }, (_, s) => (s ? hexCenter(s, SIZE) : [0, 0]));
    const xs = centers.slice(1).map((c) => c[0]!);
    const ys = centers.slice(1).map((c) => c[1]!);
    const pad = SIZE * 1.15;
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + 2 * pad, h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    this.svg = el("svg", { viewBox: `${minX} ${minY} ${w} ${h}`, class: "board", role: "img", "aria-label": "Starchess board" });

    const defs = el("defs");
    defs.innerHTML = `
      <radialGradient id="check-glow"><stop offset="0" stop-color="#ff4d4d" stop-opacity=".9"/><stop offset="1" stop-color="#ff4d4d" stop-opacity="0"/></radialGradient>
      <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".45"/></filter>`;
    this.svg.append(defs);

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
      hexLayer.append(g);
      this.hexes[s] = g;
    }
    this.svg.append(hexLayer);
    this.pieceLayer = el("g", { class: "pieces" });
    this.svg.append(this.pieceLayer);
    container.append(this.svg);
  }

  private makePiece(p: number, space: number): SVGGElement {
    const g = el("g", { class: `piece ${colorOf(p) ? "black" : "white"}`, filter: "url(#piece-shadow)" });
    const t = el("text", { x: 0, y: 0 });
    t.textContent = GLYPH[typeOf(p)]!;
    g.append(t);
    g.dataset.piece = String(p);
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
    g.querySelector("text")!.textContent = GLYPH[typeOf(p)]!;
  }

  private remove(g: SVGGElement) {
    g.classList.add("gone");
    setTimeout(() => g.remove(), 400);
  }

  /** Show `g`. With `last`, the moved piece slides over and a placed piece drops in. */
  render(g: GameState, last?: Move) {
    if (last) {
      if (last.from) {
        const mover = this.pieces.get(last.from);
        const victim = this.pieces.get(last.to);
        if (victim && victim !== mover) this.remove(victim);
        if (mover) {
          this.pieces.delete(last.from);
          this.pieces.set(last.to, mover);
          this.place(mover, last.to);
          // the mover stays on top while it travels
          this.pieceLayer.append(mover);
        }
      } else if (!this.pieces.has(last.to)) {
        const fresh = this.makePiece(last.piece, last.to);
        fresh.classList.add("dropping");
        requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.remove("dropping")));
        this.pieces.set(last.to, fresh);
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

    const checked = g.phase === "play" && inCheck(g.cells, g.turn) ? kingSpace(g.cells, g.turn) : 0;
    const backs = g.phase === "setup" ? BACK_SPACES[g.turn]! : [];
    for (let s = 1; s <= SPACE_COUNT; s++) {
      const h = this.hexes[s]!;
      h.classList.toggle("last-from", !!last && last.from === s);
      h.classList.toggle("last-to", !!last && last.to === s);
      h.classList.toggle("check", s === checked);
      h.classList.toggle("setup-target", backs.includes(s) && !g.cells[s]);
    }
    for (const [s, piece] of this.pieces) piece.classList.toggle("in-check", s === checked && typeOf(g.cells[s]!) === KING);
  }

  /** Forget every piece (a new game starts without sliding pieces around). */
  clear() {
    for (const p of this.pieces.values()) p.remove();
    this.pieces.clear();
  }
}
