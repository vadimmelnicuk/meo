export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const hasPrimaryModifier = (event: KeyboardEvent | MouseEvent): boolean => {
  return isMac ? event.metaKey : event.ctrlKey;
};

export const hasSecondaryModifier = (event: KeyboardEvent | MouseEvent): boolean => {
  return isMac ? event.ctrlKey : event.metaKey;
};
