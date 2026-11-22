import { omni } from '../../services/onlineMusic/omni';
import { setProviderSearchCommands } from './commandRegistry';
import { buildProviderSearchCommands } from './commands/searchCommands';

// src/components/command-palette/providerSearchCommandsInstaller.ts
// Keeps one search command per registered online source in the command list (Folium 2.0 plan §7: there is no
// default platform, and the search commands follow the sources there are). Installed once from bootstrap, in
// the main window, before anything renders; a source that comes or goes later puts the commands in again.

let installed = false;

const install = () => setProviderSearchCommands(buildProviderSearchCommands(omni.getProviderSummaries().map(provider => provider.providerId)));

export const installProviderSearchCommands = (): void => {
    install();
    if (installed) return;
    installed = true;
    omni.subscribeProviders(install);
};
