'use client';

import React, { createContext, useContext } from 'react';

/**
 * Global Modal Portal Container
 * This component creates a dedicated DOM container at the root level
 * to render all modals, ensuring they're always on top without z-index conflicts
 */

interface ModalContextType {
  container: HTMLDivElement | null;
}

const ModalContext = createContext<ModalContextType>({ container: null });

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);

  React.useEffect(() => {
    // Find or create the global modal container
    let modalContainer = document.getElementById('__modal-root__') as HTMLDivElement | null;
    
    if (!modalContainer) {
      modalContainer = document.createElement('div');
      modalContainer.id = '__modal-root__';
      modalContainer.setAttribute('role', 'presentation');
      modalContainer.style.position = 'fixed';
      modalContainer.style.top = '0';
      modalContainer.style.left = '0';
      modalContainer.style.right = '0';
      modalContainer.style.bottom = '0';
      modalContainer.style.pointerEvents = 'none';
      modalContainer.style.zIndex = '2147483647'; // Maximum z-index value
      document.body.appendChild(modalContainer);
    }
    
    setContainer(modalContainer);

    return () => {
      // Don't remove the container on unmount - it should persist for the app lifecycle
    };
  }, []);

  return (
    <ModalContext.Provider value={{ container }}>
      {children}
    </ModalContext.Provider>
  );
}

export function useModalContainer() {
  const context = useContext(ModalContext);
  if (!context.container) {
    console.warn('useModalContainer must be used within ModalProvider');
  }
  return context.container;
}
