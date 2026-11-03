// Passages from public-domain books. Plain ASCII only, so every character
// on the page is one a keyboard can type without a compose key.
export interface Quote {
  id: number;
  text: string;
  source: string;
}

export const quotes: Quote[] = [
  {
    text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    source: "Jane Austen, Pride and Prejudice",
  },
  {
    text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.",
    source: "Charles Dickens, A Tale of Two Cities",
  },
  {
    text: "Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little.",
    source: "Herman Melville, Moby-Dick",
  },
  {
    text: "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.",
    source: "Lewis Carroll, Alice's Adventures in Wonderland",
  },
  {
    text: "Happy families are all alike; every unhappy family is unhappy in its own way.",
    source: "Leo Tolstoy, Anna Karenina",
  },
  {
    text: "In my younger and more vulnerable years my father gave me some advice that I have been turning over in my mind ever since.",
    source: "F. Scott Fitzgerald, The Great Gatsby",
  },
  {
    text: "There was no possibility of taking a walk that day. We had been wandering, indeed, in the leafless shrubbery an hour in the morning.",
    source: "Charlotte Bronte, Jane Eyre",
  },
  {
    text: "You don't know about me without you have read a book by the name of The Adventures of Tom Sawyer; but that ain't no matter.",
    source: "Mark Twain, Adventures of Huckleberry Finn",
  },
  {
    text: "Whether I shall turn out to be the hero of my own life, or whether that station will be held by anybody else, these pages must show.",
    source: "Charles Dickens, David Copperfield",
  },
  {
    text: "As Gregor Samsa awoke one morning from uneasy dreams he found himself transformed in his bed into a gigantic insect.",
    source: "Franz Kafka, The Metamorphosis",
  },
  {
    text: "Marley was dead: to begin with. There is no doubt whatever about that. The register of his burial was signed by the clergyman.",
    source: "Charles Dickens, A Christmas Carol",
  },
  {
    text: "The time traveller, for so it will be convenient to speak of him, was expounding a recondite matter to us.",
    source: "H. G. Wells, The Time Machine",
  },
].map((q, id) => ({ id, ...q }));

export function randomQuote(exclude?: number): Quote {
  const pool = quotes.filter((q) => q.id !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}
