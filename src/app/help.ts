/** Opens the help dialog (still the static one in index.html until the dialogs move to React). */
export const openHelp = () => (document.getElementById('help') as HTMLDialogElement | null)?.showModal();
