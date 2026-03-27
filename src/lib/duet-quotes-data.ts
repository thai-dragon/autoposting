/** Quote text only — no DB (safe to import from reel / edge bundles). */

export const DUET_QUOTES: Record<string, string[]> = {
  ignorance: [
    "It's good to see you. Stay close to me, and don't touch anything.",
    "You will need a circular state of mind.",
    "This will be easy, just hold left.",
    "Never give up.",
    "Some things are worth fighting for.",
  ],
  denial: [
    "This will be full of unexpected twists and turns.",
    "Tread carefully, and control yourself.",
    "Trust your instincts.",
    "Change is normal.",
    "Do not deny it.",
    "Embrace it.",
  ],
  anger: [
    "Anger may make certain choices clearer.",
    "Patterns always emerge, even in chaos.",
    "This may not define you.",
    "Let it amplify you.",
    "Repeating the same actions but expecting new results is a sign of madness.",
  ],
  bargaining: [
    "It's also a sign that you're human.",
    "Once an action is done, it cannot be undone.",
    "You can not get out of this.",
    "Accept the situation, and move on.",
    "To try, invites failure.",
    "Embrace it.",
  ],
  guilt: [
    "It's all a matter of perspective.",
    "Regret has two signs.",
    "The things we do...",
    "And the things we wish we had done.",
    "Others may try to make you feel guilty.",
    "Guilt can only truly come from within.",
  ],
  depression: [
    "Nothing is wrong with you.",
    "Why are you doing this for yourself?",
    "What exactly are you trying to prove?",
    "You will not win.",
    "All that pain and misery. Was it worth it?",
    "I don't want you to keep going.",
  ],
  hope: [
    "I want you to want to keep going.",
    "We have no reason to give up.",
    "You probably didn't expect to get this far.",
    "But if we expect something, how can it move us?",
    "Unexpected things are beautiful.",
    "Abandon all your expectations.",
  ],
  acceptance: [
    "I wish you could see this.",
    "You wouldn't be here if it weren't for me.",
    "Admit it.",
    "Change is good for you.",
    "There is nothing to regret.",
    "Anger is always temporary.",
    "Sometimes letting go is the harder choice.",
    "You must move forward.",
    "But I want you to know one last thing.",
  ],
};

export const ALL_QUOTES_FLAT: { chapter: string; text: string }[] = [];
for (const [chapter, quotes] of Object.entries(DUET_QUOTES)) {
  for (const text of quotes) {
    ALL_QUOTES_FLAT.push({ chapter, text });
  }
}

export function getTotalQuotes(): number {
  return ALL_QUOTES_FLAT.length;
}

export function getQuoteByIndex(index: number): { chapter: string; text: string } {
  return ALL_QUOTES_FLAT[index % ALL_QUOTES_FLAT.length];
}
