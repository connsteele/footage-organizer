// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilenameInput } from '../src/client/FilenameInput';

afterEach(cleanup);

function Editor({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('Chapter 1. Opening.MP4');
  return (
    <>
      <FilenameInput value={value} label="Clip filename" disabled={disabled} onChange={setValue} />
      <output aria-label="Saved filename">{value}</output>
    </>
  );
}

it('keeps the extension outside selection, deletion, and pasted filename edits', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const input = screen.getByRole('textbox', { name: 'Clip filename' }) as HTMLInputElement;
  expect(input.value).toBe('Chapter 1. Opening');
  await user.click(input);
  await user.keyboard('{Control>}a{/Control}{Backspace}');
  expect(input.value).toBe('');
  expect(screen.getByLabelText('Saved filename').textContent).toBe('.MP4');
  await user.type(input, 'Chapter 2. Arrival');
  await user.keyboard('{End}{Delete}');
  expect(screen.getByLabelText('Saved filename').textContent).toBe('Chapter 2. Arrival.MP4');
  await user.keyboard('{Control>}a{/Control}');
  await user.paste('New title.mov');
  expect(screen.getByLabelText('Saved filename').textContent).toBe('New title.mov.MP4');
  expect(screen.getByTitle('File extension (not editable)').textContent).toBe('.MP4');
});

it('keeps filed or otherwise locked filenames disabled', async () => {
  const user = userEvent.setup();
  render(<Editor disabled />);
  const input = screen.getByRole('textbox', { name: 'Clip filename' }) as HTMLInputElement;
  expect(input.disabled).toBe(true);
  await user.type(input, 'Replacement');
  expect(screen.getByLabelText('Saved filename').textContent).toBe('Chapter 1. Opening.MP4');
});
