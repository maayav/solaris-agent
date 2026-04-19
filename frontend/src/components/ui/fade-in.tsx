import React from 'react';
import { motion } from 'framer-motion';

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  key?: React.Key;
}

export const FadeIn = ({ children, delay = 0, className = "" }: FadeInProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{
        duration: 0.7,
        delay: delay,
        ease: [0.16, 1, 0.3, 1], // Quintic easeOut for a more premium feel
      }}
      className={`${className} will-change-[opacity,transform]`}
    >
      {children}
    </motion.div>
  );
};
