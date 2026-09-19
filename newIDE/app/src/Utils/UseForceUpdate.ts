import * as React from 'react';

// https://reactjs.org/docs/hooks-faq.html#is-there-something-like-forceupdate
export default function useForceUpdate(): () => void {
  const [, updateState] = React.useState<{}>();
  const forceUpdate = React.useCallback(() => updateState({}), []);

  return forceUpdate;
}

export function useForceRecompute(): [Record<string, never>, () => void] {
  const [recomputeTrigger, updateState] = React.useState<Record<string, never>>(
    {}
  );
  const forceRecompute = React.useCallback(() => updateState({}), []);

  return [recomputeTrigger, forceRecompute];
}
