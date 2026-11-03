'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useModalContainer } from './ModalProvider';

interface ModalPortalProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose?: () => void;
}

export function ModalPortal({ children, isOpen, onClose }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);
  const modalContainer = useModalContainer();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || !modalContainer) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="modal-backdrop"
          className="fixed inset-0 flex items-center justify-center bg-black/50"
          onClick={handleBackdropClick}
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
            zIndex: 80,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: 'relative', pointerEvents: 'auto' }}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    modalContainer
  );
}
