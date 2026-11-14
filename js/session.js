// Grown-up mode lasts until it is locked or the app closes.
// `shuffleSeed` is only ever set by the tests, to make the order of the next-day checks repeatable.
// `freshGold` holds the bars that have just won their first gold crown, until the score has shown them once.
export const session = { parent: false, installPrompt: null, runGoal: null, exitTo: '/', freshGold: new Set(), shuffleSeed: null };
