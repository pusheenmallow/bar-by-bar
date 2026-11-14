// The teacher's corner, for when the tablet comes to the lesson. It opens with the teacher's own
// PIN and reaches three things for each learner's piece: this week's assignment (with pins), the
// week's summary, and the learner's recordings. It cannot reach settings, players, backups or
// anything that deletes. Nothing leaves the tablet.
import { h, go } from '../ui.js';
import { all, currentAssignment, takesFor } from '../store.js';
import { penVar } from '../model.js';
import { session } from '../session.js';
import { doneButton } from './common.js';
import { gate } from './parent.js';

export async function teacherHome(_, ctx) {
  if (!session.teacher) return gate(() => ctx.rerender());
  const players = (await all('players')).sort((a, b) => a.createdAt - b.createdAt);
  const pieces = (await all('pieces')).filter((p) => !p.draft).sort((a, b) => a.createdAt - b.createdAt);

  const blocks = [];
  for (const person of players) {
    const theirs = pieces.filter((p) => p.playerId === person.id);
    if (!theirs.length) continue;
    const rows = [];
    for (const piece of theirs) {
      const assignment = await currentAssignment(piece.id);
      const recordings = (await takesFor(piece.id)).length;
      rows.push(h('div', { class: 'teacher-piece' },
        h('div', { class: 'teacher-title' },
          h('span', { class: 'row-main' }, piece.title),
          h('span', { class: 'row-sub' }, assignment ? `Assignment set${assignment.lessonDate ? `, lesson ${assignment.lessonDate.slice(8)}/${assignment.lessonDate.slice(5, 7)}` : ''}` : 'No assignment yet')),
        h('div', { class: 'row-buttons left' },
          h('button', { class: 'btn primary', 'aria-label': `Assignment: ${piece.title}, ${person.name}`, onClick: () => go(`/teacher/assign/${piece.id}`) }, 'Assignment'),
          h('button', { class: 'btn', 'aria-label': `This week: ${piece.title}, ${person.name}`, onClick: () => go(`/teacher/summary/${piece.id}`) }, 'This week'),
          h('button', { class: 'btn', 'aria-label': `Recordings: ${piece.title}, ${person.name}`, onClick: () => go(`/teacher/takes/${piece.id}`) },
            recordings ? `Recordings (${recordings})` : 'Recordings'))));
    }
    blocks.push(h('section', { class: 'block' },
      h('h2', {}, h('span', { class: 'swatch', style: { background: penVar(person.pen) } }), ' ', person.name),
      rows));
  }

  return h('main', { class: 'screen form teacher' },
    h('header', { class: 'bar-top' }, h('h1', {}, 'Teacher'), doneButton()),
    h('p', { class: 'lead' }, 'Set the week’s work, see how the week went, and hear recordings. Everything stays on this tablet.'),
    blocks.length ? blocks : h('p', { class: 'lead' }, 'No pieces have been added yet. A grown-up adds them.'));
}
