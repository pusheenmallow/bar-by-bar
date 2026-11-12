// Shadow grading: a test of how well a child's own "clean" and "slip" match a grown-up's ear.
// When it is switched on in Grown-ups, each tap the child makes brings up a small prompt for the
// grown-up sitting beside them. Their answer is saved on that attempt as `shadow`. It changes
// nothing the child sees or earns, and skipping is always fine.

import { h } from './ui.js';
import { getMeta, setMeta, gradeAttempt } from './store.js';

const KEY = 'shadowGrade';
export const shadowOn = () => getMeta(KEY, false);
export const setShadow = (on) => setMeta(KEY, !!on);

export class Shadow {
  // Null when shadow grading is off, so screens can write `shadow?.ask()`.
  static async load() {
    return (await shadowOn()) ? new Shadow() : null;
  }

  constructor() {
    this.el = null;
  }

  // Call at the child's tap. Returns a ticket for that play; an unanswered earlier prompt goes.
  ask() {
    this.hide();
    const ticket = { grade: null, attempt: null };
    const answer = (grade) => {
      ticket.grade = grade;
      if (ticket.attempt) gradeAttempt(ticket.attempt.id, grade);
      this.hide();
    };
    this.el = h('div', { class: 'shadow-ask', role: 'group', 'aria-label': 'Grown-up check' },
      h('span', { class: 'shadow-label' }, 'Grown-up: clean or slip?'),
      h('button', { class: 'btn shadow-btn', onClick: () => answer('slip') }, 'Slip'),
      h('button', { class: 'btn shadow-btn', onClick: () => answer('clean') }, 'Clean'),
      h('button', { class: 'quiet-link', onClick: () => this.hide() }, 'Skip'));
    document.getElementById('layer').append(this.el);
    return ticket;
  }

  // Call when the play has been saved. A grade given in between is added to it.
  saved(ticket, attempt) {
    if (!ticket) return;
    ticket.attempt = attempt;
    if (ticket.grade && attempt.shadow !== ticket.grade) gradeAttempt(attempt.id, ticket.grade);
  }

  hide() {
    this.el?.remove();
    this.el = null;
  }

  close() { this.hide(); }
}
