import type { PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';
import type { BeautyMembership } from '../../auth/types';

const BeautyBusinessContext = createContext<BeautyMembership | null>(null);

export function BeautyBusinessProvider({
  children,
  membership,
}: PropsWithChildren<{ membership: BeautyMembership }>) {
  return (
    <BeautyBusinessContext.Provider value={membership}>
      {children}
    </BeautyBusinessContext.Provider>
  );
}

export function useBeautyBusiness() {
  const value = useContext(BeautyBusinessContext);
  if (!value) throw new Error('useBeautyBusiness debe utilizarse dentro de BeautyBusinessProvider.');
  return value;
}
