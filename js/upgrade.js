// The step before a database upgrade: save a backup file, then let the upgrade run.
// An upgrade can't be undone, so the backup comes first and can't be skipped.

import { h, fill } from './ui.js';
import { dayKey } from './model.js';

const app = () => document.getElementById('app');

function download(blob, name) {
  const link = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

// Resolves once a backup file has been saved and a person has tapped to go on.
export function upgradeGate({ makeBackup }) {
  return new Promise((resolve) => {
    const name = `bar-by-bar-backup-before-update-${dayKey(Date.now())}.json`;
    const status = h('p', { class: 'upgrade-status', role: 'status' });
    const buttons = h('div', { class: 'row-buttons narrow' });
    let blob = null;

    async function save() {
      fill(buttons, h('button', { class: 'btn primary big', disabled: true }, 'Making the backup file'));
      status.textContent = '';
      try {
        blob ||= await makeBackup();
        download(blob, name);
      } catch (err) {
        status.textContent = `The backup could not be made, so nothing has been changed. ${err.message}`;
        fill(buttons, h('button', { class: 'btn primary big', onClick: save }, 'Try again'));
        return;
      }
      status.textContent = `Saved to Downloads as ${name}. Keep it somewhere safe.`;
      fill(buttons,
        h('button', { class: 'btn', onClick: () => download(blob, name) }, 'Save it again'),
        h('button', { class: 'btn primary big', onClick: () => { status.textContent = 'Finishing the update'; fill(buttons); resolve(); } }, 'Finish the update'));
    }

    fill(buttons, h('button', { class: 'btn primary big', onClick: save }, 'Save the backup'));
    app().replaceChildren(h('main', { class: 'screen upgrade' },
      h('h1', {}, 'Bar by Bar has an update'),
      h('p', { class: 'lead' }, 'First, a backup file of everything on this tablet is saved: players, pieces, progress and recordings. Then the update finishes. Nothing already on this tablet is changed or lost.'),
      buttons,
      status));
  });
}

export function upgradeFailed() {
  return h('main', { class: 'screen upgrade' },
    h('h1', {}, 'The update could not finish'),
    h('p', { class: 'lead' }, 'Nothing was changed. Everything on this tablet is as it was, and the backup file is in Downloads.'),
    h('div', { class: 'row-buttons narrow' },
      h('button', { class: 'btn primary big', onClick: () => location.reload() }, 'Try again')));
}
