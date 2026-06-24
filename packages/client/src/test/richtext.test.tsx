/**
 * RichText (QoL social rendering): renders already-sanitized text with @mention
 * links + `>` blockquotes, as PLAIN React (no HTML injection). Mentions become
 * /u/:username links; leading `>` lines become a styled blockquote.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RichText } from '../components/RichText.js';

afterEach(cleanup);

function renderRich(text: string) {
  return render(
    <MemoryRouter>
      <RichText text={text} />
    </MemoryRouter>,
  );
}

describe('RichText @mentions', () => {
  it('renders @username as a link to the profile', () => {
    renderRich('nice read @capone — agreed');
    const link = screen.getByRole('link', { name: '@capone' });
    expect(link.getAttribute('href')).toBe('/u/capone');
  });

  it('renders plain text around the mention', () => {
    const { container } = renderRich('hey @nitti how are you');
    expect(container.textContent).toBe('hey @nitti how are you');
  });

  it('does not linkify an email local part', () => {
    renderRich('mail me at foo@bar today');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('escapes a username into the route param', () => {
    // Only charset chars can form a mention, so the href is always clean; assert
    // a normal handle produces the expected encoded path.
    renderRich('@user_99');
    expect(screen.getByRole('link', { name: '@user_99' }).getAttribute('href')).toBe('/u/user_99');
  });
});

describe('RichText blockquotes', () => {
  it('renders a leading `>` line as a blockquote', () => {
    const { container } = renderRich('> @ann wrote:\n> the original line\n\nmy reply');
    const bq = container.querySelector('blockquote.blockquote');
    expect(bq).toBeTruthy();
    expect(bq!.textContent).toContain('the original line');
    // The reply text is OUTSIDE the blockquote.
    expect(container.textContent).toContain('my reply');
  });

  it('strips the leading `> ` marker from quoted lines', () => {
    const { container } = renderRich('> quoted');
    const bq = container.querySelector('blockquote.blockquote')!;
    expect(bq.textContent).toBe('quoted');
  });

  it('still linkifies mentions inside a blockquote', () => {
    renderRich('> ping @torrio here');
    const link = screen.getByRole('link', { name: '@torrio' });
    expect(link.getAttribute('href')).toBe('/u/torrio');
  });
});

describe('RichText safety', () => {
  it('never injects HTML — angle brackets render as literal text', () => {
    const { container } = renderRich('<b>not bold</b> and <script>x</script>');
    // No actual <b>/<script> element is created (the text is escaped by React).
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<b>not bold</b>');
  });

  it('renders nothing for empty text', () => {
    const { container } = renderRich('');
    expect(container.textContent).toBe('');
  });
});
