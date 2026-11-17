import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Alias `@/` vers la racine, comme tsconfig.json ("@/*": ["./*"]) : sans lui,
// les imports `@/lib/...` de lib/chat-handler.ts ne se résolvent pas sous Vitest.
// Pas de setupFiles global : les tests historiques (dvf, sete) appellent le
// réseau ; le verrou hermétique est importé par chaque __tests__/chat-*.test.ts.
const root = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: 'node',
  },
});
