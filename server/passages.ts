import { quotes, randomQuote, type Quote } from "./quotes.ts";

// What a race can be run on. Quotes are the default; words drops capitals and
// punctuation for pure speed; code adds symbols, newlines and indentation;
// sprint is words again, but an open-ended stream run against a clock instead
// of a fixed passage, so the race is won on WPM rather than on finishing.
export const MODES = ["quotes", "words", "code", "sprint"] as const;
export type Mode = (typeof MODES)[number];

export const isMode = (m: unknown): m is Mode => MODES.includes(m as Mode);

// How long a sprint runs. Nobody can reach the end of its word list in this
// long at the server's own typing-speed cap, so it always ends on the clock.
export const SPRINT_MS = 30_000;

// Common English words, lowercase letters only.
const WORDS = `the of and to in is you that it he was for on are as with his they at be
this have from or one had by word but not what all were we when your can said there use
an each which she do how their if will up other about out many then them these so some her
would make like him into time has look two more write go see number no way could people my
than first water been call who oil its now find long down day did get come made may part
over new sound take only little work know place year live me back give most very after
thing our just name good sentence man think say great where help through much before line
right too mean old any same tell boy follow came want show also around form three small set
put end does another well large must big even such because turn here why ask went men read
need land different home us move try kind hand picture again change off play spell air away
animal house point page letter mother answer found study still learn should world high every
near add food between own below country plant last school father keep tree never start city
earth eye light thought head under story saw left few while along might close something seem
next hard open example begin life always those both paper together got group often run`.split(/\s+/);

export const WORD_COUNT = 30;

// A sprint's word list has to outlast the fastest possible typist: at the
// server's MAX_CPS cap that's 25 * (SPRINT_MS / 1000) characters, and this is
// sized with room to spare over that.
const SPRINT_WORD_COUNT = 250;

function randomWords(count: number): string[] {
  const picked: string[] = [];
  while (picked.length < count) {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (w !== picked[picked.length - 1]) picked.push(w);
  }
  return picked;
}

// Short, self-contained snippets. Two-space indents, no tabs and no trailing
// whitespace: indentation is typed for you after each newline, so only the
// code itself counts.
export const snippets: Quote[] = [
  {
    text: `function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}`,
    source: "JavaScript",
  },
  {
    text: `def is_prime(n):
  if n < 2:
    return False
  return all(n % d for d in range(2, int(n ** 0.5) + 1))`,
    source: "Python",
  },
  {
    text: `const counts = {};
for (const word of text.split(" ")) {
  counts[word] = (counts[word] ?? 0) + 1;
}`,
    source: "JavaScript",
  },
  {
    text: `fn main() {
  let v: Vec<i32> = (1..=10).filter(|x| x % 2 == 0).collect();
  println!("{:?}", v);
}`,
    source: "Rust",
  },
  {
    text: `SELECT p.name, MAX(r.wpm) AS best
  FROM results r
  JOIN players p ON p.id = r.player_id
 GROUP BY p.id
 ORDER BY best DESC;`,
    source: "SQL",
  },
  {
    text: `interface Point {
  x: number;
  y: number;
}
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);`,
    source: "TypeScript",
  },
  {
    text: `for i in range(1, 16):
  print("FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0 else i)`,
    source: "Python",
  },
  {
    text: `#include <stdio.h>

int main(void) {
  printf("hello, world\\n");
  return 0;
}`,
    source: "C",
  },
  {
    text: `quicksort [] = []
quicksort (p:xs) = quicksort [x | x <- xs, x < p]
  ++ [p] ++ quicksort [x | x <- xs, x >= p]`,
    source: "Haskell",
  },
  {
    text: `async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}`,
    source: "JavaScript",
  },
].map((q, id) => ({ id: id + quotes.length, ...q }));

export function randomPassage(mode: Mode, exclude?: number): Quote {
  if (mode === "words") return { id: -1, text: randomWords(WORD_COUNT).join(" "), source: `${WORD_COUNT} random words` };
  if (mode === "sprint")
    return {
      id: -2,
      text: randomWords(SPRINT_WORD_COUNT).join(" "),
      source: `${SPRINT_MS / 1000}s sprint · highest wpm wins`,
    };
  if (mode === "code") {
    const pool = snippets.filter((q) => q.id !== exclude);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return randomQuote(exclude);
}
