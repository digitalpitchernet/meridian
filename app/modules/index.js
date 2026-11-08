// Built modules: id -> { routes: [{ pattern, render(ctx, params, query, path, setCrumbs) }] }.
// Modules not listed here route to the "not built yet" page (modules/placeholder.js).
import { projectsModule } from './projects.js';
import { tasksModule } from './tasks.js';
import { commandModule } from './command.js';
import { milestonesModule } from './milestones.js';
import { calendarModule } from './calendar.js';
import { contactsModule } from './contacts.js';
import { decisionsModule } from './decisions.js';
import { financesModule } from './finances.js';
import { settingsModule } from './settings.js';
import { vaultModule } from './vault.js';

export const BUILT = {
  command: commandModule,
  projects: projectsModule,
  tasks: tasksModule,
  milestones: milestonesModule,
  calendar: calendarModule,
  contacts: contactsModule,
  decisions: decisionsModule,
  finances: financesModule,
  settings: settingsModule,
  vault: vaultModule,
};
