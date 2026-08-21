import { useEffect } from 'react';

export const useTimeout = (callback: () => void, delay: number): void => {
  useEffect(
    () => {
      const id = setTimeout(callback, delay);
      return () => clearTimeout(id);
    },
    [callback, delay]
  );
};
