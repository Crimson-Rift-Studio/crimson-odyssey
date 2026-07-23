import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function readMaskedInput(prompt, { input = stdin, output = stdout } = {}) {
  return new Promise((resolve, reject) => {
    const characters = [];
    const wasRaw = Boolean(input.isRaw);
    const redraw = () => output.write(`\r\x1b[2K${prompt}${'*'.repeat(characters.length)}`);
    const cleanup = () => {
      input.off('data', onData);
      if (input.isTTY && input.setRawMode && !wasRaw) input.setRawMode(false);
    };
    const finish = (error) => {
      cleanup();
      output.write('\n');
      if (error) reject(error);
      else resolve(characters.join('').trim());
    };
    const onData = (chunk) => {
      const text = String(chunk).replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '');
      for (const character of text) {
        if (character === '\x03') return finish(new Error('Secret input cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\b' || character === '\x7f') characters.pop();
        else if (character >= ' ') characters.push(character);
      }
      redraw();
    };

    output.write(prompt);
    if (input.isTTY && input.setRawMode && !wasRaw) input.setRawMode(true);
    input.setEncoding?.('utf8');
    input.on('data', onData);
    input.resume?.();
  });
}

export async function readSecret(prompt, { input = stdin, output = stdout } = {}) {
  if (!input.isTTY) {
    const reader = readline.createInterface({ input, output });
    try { return (await reader.question(prompt)).trim(); }
    finally { reader.close(); }
  }
  return readMaskedInput(prompt, { input, output });
}
