// npm run keys: print fresh DATA_KEY and ID_SALT for .env (32 random bytes each, base64). Never commit them.

import { generateKeys } from '../config.js';

const k = generateKeys();
process.stdout.write(`# Paste into .env (never commit, never paste into chat)\nDATA_KEY=${k.DATA_KEY}\nID_SALT=${k.ID_SALT}\n`);
