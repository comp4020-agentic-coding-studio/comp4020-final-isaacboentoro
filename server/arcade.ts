// Arcade scoring. The server keeps every racer's score itself, from the same
// progress and misses it already gets for each keystroke: the page shows a
// score, but never gets to claim one, so the typing-speed cap still holds.
//
// - Every correct letter is worth LETTER points, times your multiplier.
// - Each letter in a row without a miss builds your combo; a miss breaks it.
// - A word finished without a single miss is clean: it builds your streak,
//   and pays WORD points per letter, times your multiplier.
// - Your streak of clean words sets the multiplier; a miss resets it to x1.

export const ARCADE_MS = 45_000;
export const LETTER = 10;
export const WORD = 25;
// clean words in a row needed for each multiplier: x1, x2, x3, x4
export const TIERS = [0, 5, 15, 30];

export interface Score {
  points: number;
  combo: number; // letters in a row without a miss
  best: number; // longest combo
  streak: number; // clean words in a row
  clean: boolean; // no miss yet in the word being typed
  scored: number; // the furthest character paid for: retyping pays nothing
}

export const fresh = (): Score => ({ points: 0, combo: 0, best: 0, streak: 0, clean: true, scored: 0 });

export function multiplier(streak: number): number {
  let m = 0;
  while (m + 1 < TIERS.length && streak >= TIERS[m + 1]) m++;
  return m + 1;
}

// A miss: the combo and the streak are both gone, and the word in progress
// can't be clean any more.
export function miss(s: Score): void {
  s.combo = 0;
  s.streak = 0;
  s.clean = false;
}

// Progress reached `to` characters of `text`: score each letter past the
// furthest already paid for, and each word it closes out.
export function advance(s: Score, text: string, to: number): void {
  for (let i = s.scored; i < to; i++) {
    s.points += LETTER * multiplier(s.streak);
    s.combo++;
    s.best = Math.max(s.best, s.combo);
    // a word closes on its boundary space, or at the end of the passage
    if (text[i] === " " || i === text.length - 1) {
      if (s.clean) {
        s.streak++;
        s.points += WORD * wordLength(text, i) * multiplier(s.streak);
      }
      s.clean = true;
    }
  }
  s.scored = Math.max(s.scored, to);
}

// letters in the word that ends at `end` (its space, or its last letter)
function wordLength(text: string, end: number): number {
  let i = text[end] === " " ? end - 1 : end;
  let n = 0;
  while (i >= 0 && text[i] !== " ") {
    n++;
    i--;
  }
  return n;
}
