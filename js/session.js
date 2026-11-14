// Grown-up mode lasts until it is locked or the app closes.
// `parent` is true while Grown-ups is unlocked, `teacher` while the Teacher screens are. Each is
// open only while on its own screens.
// `loadedAssignment` is an assignment just read from a file, waiting to be shown in the form.
// `today` is the queue of stops for the session in progress, from Today's practice or Quick practice
// until the player is back at their pieces. See screens/today.js.
// `shuffleSeed` is only ever set by the tests, to make the order of the next-day checks repeatable.
// `freshGold` holds the bars that have just won their first gold crown, until the score has shown them once.
export const session = { parent: false, teacher: false, installPrompt: null, runGoal: null, exitTo: '/', freshGold: new Set(), shuffleSeed: null, today: null, loadedAssignment: null };
