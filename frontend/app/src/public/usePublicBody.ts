import { useEffect } from 'react';

/** The public site and auth pages sit on the design's dark body; restore the app's body when leaving. */
export function usePublicBody() {
  useEffect(() => {
    document.body.classList.add('pub-body');
    return () => document.body.classList.remove('pub-body');
  }, []);
}
